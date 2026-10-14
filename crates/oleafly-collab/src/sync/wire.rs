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
    connect_socket, keep_polling, post_outbox, Outbox, PollChannel, PollRequest, PollTiming,
    Polled, Socket,
};
use crate::CollabError;

const POLL_QUEUE: usize = 64;
const CLOSE_WITHIN: Duration = Duration::from_secs(2);

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
            let access = link
                .sessions
                .force_refresh(link.server_id, &link.client)
                .await?;
            connect_socket(
                link.client.url(),
                link.server_id,
                &access,
                link.device_id,
                &link.signing_key(),
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

pub(super) enum Wire {
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
    pub(super) fn socket(socket: Socket) -> Wire {
        let (sink, stream) = socket.split();
        Wire::Socket { sink, stream }
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

    pub(super) async fn next(&mut self) -> Result<ServerFrame, CollabError> {
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

    pub(super) async fn close(&mut self) {
        match self {
            Wire::Socket { sink, .. } => {
                let _ = sink.close().await;
            }
            Wire::Poll(poll) => poll.close().await,
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
