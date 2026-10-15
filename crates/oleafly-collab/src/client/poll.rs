use std::collections::VecDeque;
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use ::url::Url;
use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use oleafly_collab_protocol::ids::{DeviceId, ServerId, SharedProjectId};
use oleafly_collab_protocol::poll::{
    understands_header, PollBatch, PollFrames, PollReplies, DEVICE_HEADER, MAX_POSTED_FRAMES,
    NONCE_HEADER, POLL_KEY_HEADER, PROTOCOL_HEADER, SIGNATURE_HEADER, UNDERSTANDS_HEADER,
};
use tokio::sync::{mpsc, Notify};

use super::http::{check_status, network_error};
use super::{upload_allowance, ServerClient};
use crate::{CollabError, DeviceKey};

const POLL_TIMEOUT: Duration = Duration::from_secs(45);
const POST_TIMEOUT: Duration = Duration::from_secs(60);
const POST_BYTES: usize = 8 * 1024 * 1024;
const ANSWER_BYTES: usize = 32 * 1024 * 1024;

pub(crate) type Polled = Result<Vec<ServerFrame>, CollabError>;

#[derive(Clone, Copy, Debug)]
pub(crate) struct PollTiming {
    pub(crate) longest: Duration,
    pub(crate) shortest: Duration,
    pub(crate) retry: Duration,
    pub(crate) attempts: u32,
}

impl Default for PollTiming {
    fn default() -> PollTiming {
        PollTiming {
            longest: POLL_TIMEOUT,
            shortest: Duration::from_secs(5),
            retry: Duration::from_millis(500),
            attempts: 3,
        }
    }
}

#[derive(Default)]
pub(crate) struct Outbox {
    queue: Mutex<VecDeque<ClientFrame>>,
    ready: Notify,
}

fn replaces(queued: &ClientFrame, fresh: &ClientFrame) -> bool {
    matches!(
        (queued, fresh),
        (ClientFrame::Presence { .. }, ClientFrame::Presence { .. })
            | (ClientFrame::Ping { .. }, ClientFrame::Ping { .. })
    )
}

fn posted_bytes(frame: &ClientFrame) -> usize {
    match frame {
        ClientFrame::Update { envelope, .. } => envelope.payload.len() * 4 / 3 + 512,
        _ => 256,
    }
}

impl Outbox {
    pub(crate) fn push(&self, frame: ClientFrame) {
        {
            let mut queue = self.queue.lock().unwrap_or_else(PoisonError::into_inner);
            queue.retain(|queued| !replaces(queued, &frame));
            queue.push_back(frame);
        }
        self.ready.notify_one();
    }

    pub(crate) fn take(&self) -> Vec<ClientFrame> {
        let mut queue = self.queue.lock().unwrap_or_else(PoisonError::into_inner);
        let mut taken = Vec::new();
        let mut bytes = 0;
        while let Some(next) = queue.front() {
            let size = posted_bytes(next);
            if !taken.is_empty() && (taken.len() >= MAX_POSTED_FRAMES || bytes + size > POST_BYTES)
            {
                break;
            }
            bytes += size;
            taken.extend(queue.pop_front());
        }
        taken
    }

    async fn next_batch(&self) -> Vec<ClientFrame> {
        loop {
            let taken = self.take();
            if !taken.is_empty() {
                return taken;
            }
            self.ready.notified().await;
        }
    }
}

pub(crate) async fn post_outbox(
    channel: PollChannel,
    outbox: std::sync::Arc<Outbox>,
    replies: mpsc::Sender<Polled>,
) {
    loop {
        let frames = outbox.next_batch().await;
        let leaving = frames
            .iter()
            .any(|frame| matches!(frame, ClientFrame::Unsubscribe { .. }));
        match channel.send(frames).await {
            Ok(answered) => {
                if !answered.is_empty() {
                    let _ = replies.send(Ok(answered)).await;
                }
            }
            Err(CollabError::Api {
                status: 413,
                message,
                ..
            }) => {
                let refused = ServerFrame::Error {
                    code: FrameErrorCode::TooLarge,
                    message,
                };
                let _ = replies.send(Ok(vec![refused])).await;
            }
            Err(error) => {
                let _ = replies.send(Err(error)).await;
                return;
            }
        }
        if leaving {
            return;
        }
    }
}

pub(crate) async fn keep_polling(
    channel: PollChannel,
    mut cursor: String,
    frames: mpsc::Sender<Polled>,
    timing: PollTiming,
) {
    let mut failures = 0u32;
    let mut hold = timing.longest;
    loop {
        let started = tokio::time::Instant::now();
        let failure = match channel.poll(&cursor, hold).await {
            Ok(Some(batch)) => {
                failures = 0;
                if let Some(next) = batch.cursor {
                    cursor = next;
                }
                if !batch.frames.is_empty() && frames.send(Ok(batch.frames)).await.is_err() {
                    return;
                }
                continue;
            }
            Ok(None) if hold < timing.longest => continue,
            Ok(None) => CollabError::Network("the server did not answer in time".to_owned()),
            Err(CollabError::Api {
                status: 502..=504, ..
            }) => {
                hold = shorter_hold(hold, started.elapsed(), &timing);
                tokio::time::sleep(timing.retry).await;
                continue;
            }
            Err(
                error @ (CollabError::Api { status: 404, .. }
                | CollabError::Unauthorized
                | CollabError::SessionEnded(_)),
            ) => {
                let _ = frames.send(Err(error)).await;
                return;
            }
            Err(error) => error,
        };
        failures += 1;
        if failures >= timing.attempts {
            let _ = frames.send(Err(failure)).await;
            return;
        }
        tokio::time::sleep(timing.retry).await;
    }
}

fn shorter_hold(hold: Duration, waited: Duration, timing: &PollTiming) -> Duration {
    if waited < timing.shortest {
        return hold;
    }
    hold.min(waited.mul_f64(0.75).max(timing.shortest))
}

pub(crate) struct PollOpen {
    pub(crate) frames: Vec<ServerFrame>,
    pub(crate) channel: Option<(PollChannel, String)>,
}

#[derive(Clone)]
pub(crate) struct PollChannel {
    http: reqwest::Client,
    poll: Url,
    frames: Url,
    key: String,
}

pub(crate) struct PollRequest<'a> {
    pub(crate) server_id: ServerId,
    pub(crate) access_token: &'a str,
    pub(crate) device_id: DeviceId,
    pub(crate) key: &'a DeviceKey,
    pub(crate) project: SharedProjectId,
    pub(crate) since: u64,
}

pub(crate) async fn answer_within(
    request: reqwest::RequestBuilder,
    limit: usize,
) -> Result<(u16, Vec<u8>), CollabError> {
    let response = check_status(request.send().await.map_err(network_error)?).await?;
    let status = response.status().as_u16();
    let body = super::http::body_within(response, limit).await?;
    Ok((status, body))
}

fn unreadable(status: u16, error: &serde_json::Error) -> CollabError {
    CollabError::Api {
        status,
        code: "invalid_response".to_string(),
        message: error.to_string(),
    }
}

async fn read_batch(request: reqwest::RequestBuilder) -> Result<PollBatch, CollabError> {
    let (status, body) = answer_within(request, ANSWER_BYTES).await?;
    PollBatch::from_json(&body).map_err(|error| unreadable(status, &error))
}

fn project_url(client: &ServerClient, project: SharedProjectId, last: &str) -> Url {
    let mut url = client.url().endpoint("api/v1/projects");
    if let Ok(mut segments) = url.path_segments_mut() {
        segments.push(&project.to_string());
        segments.push(last);
    }
    url
}

impl ServerClient {
    pub(crate) async fn open_poll(
        &self,
        request: PollRequest<'_>,
    ) -> Result<PollOpen, CollabError> {
        let nonce = self.challenge().await?.nonce;
        let message = challenge_message(ChallengePurpose::Socket, request.server_id, &nonce);
        let poll = project_url(self, request.project, "poll");
        let batch = read_batch(
            self.http()
                .get(poll.clone())
                .query(&[("since", request.since.to_string())])
                .bearer_auth(request.access_token)
                .header(DEVICE_HEADER, request.device_id.to_string())
                .header(NONCE_HEADER, &nonce)
                .header(SIGNATURE_HEADER, request.key.sign_b64(&message))
                .header(PROTOCOL_HEADER, PROTOCOL_VERSION.to_string())
                .header(
                    UNDERSTANDS_HEADER,
                    understands_header(&crate::sync::UNDERSTOOD_CODES),
                )
                .timeout(POLL_TIMEOUT),
        )
        .await?;
        let channel = match (batch.key, batch.cursor) {
            (Some(key), Some(cursor)) => Some((
                PollChannel {
                    http: self.http().clone(),
                    poll,
                    frames: project_url(self, request.project, "frames"),
                    key,
                },
                cursor,
            )),
            _ => None,
        };
        Ok(PollOpen {
            frames: batch.frames,
            channel,
        })
    }
}

impl PollChannel {
    pub(crate) async fn poll(
        &self,
        cursor: &str,
        within: Duration,
    ) -> Result<Option<PollBatch>, CollabError> {
        let request = read_batch(
            self.http
                .get(self.poll.clone())
                .query(&[("cursor", cursor)])
                .header(POLL_KEY_HEADER, &self.key)
                .timeout(POLL_TIMEOUT),
        );
        match tokio::time::timeout(within, request).await {
            Ok(answered) => answered.map(Some),
            Err(_) => Ok(None),
        }
    }

    pub(crate) async fn send(
        &self,
        frames: Vec<ClientFrame>,
    ) -> Result<Vec<ServerFrame>, CollabError> {
        let posting: usize = frames.iter().map(posted_bytes).sum();
        let (status, body) = answer_within(
            self.http
                .post(self.frames.clone())
                .header(POLL_KEY_HEADER, &self.key)
                .json(&PollFrames { frames })
                .timeout(POST_TIMEOUT + upload_allowance(posting)),
            ANSWER_BYTES,
        )
        .await?;
        let replies = PollReplies::from_json(&body).map_err(|error| unreadable(status, &error))?;
        Ok(replies.frames)
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    use oleafly_collab_protocol::envelope::{Envelope, EnvelopeMode};
    use oleafly_collab_protocol::ids::BatchId;
    use oleafly_collab_protocol::projects::PresenceState;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    use super::*;

    fn update(project: SharedProjectId, bytes: usize) -> ClientFrame {
        ClientFrame::Update {
            project_id: project,
            envelope: Envelope {
                v: 1,
                project_id: project,
                batch_id: BatchId::new_v7(),
                device_id: DeviceId::new_v7(),
                mode: EnvelopeMode::Plain,
                key_epoch: None,
                payload: vec![7; bytes],
                signature: vec![1; 64],
            },
        }
    }

    fn at(project: SharedProjectId, cursor: u32) -> ClientFrame {
        ClientFrame::Presence {
            project_id: project,
            state: PresenceState {
                file_id: Some("f".to_owned()),
                cursor: Some(cursor),
                anchor: None,
            },
        }
    }

    #[test]
    fn queued_frames_go_out_together_keeping_only_the_latest_presence_and_ping() {
        let project = SharedProjectId::new_v7();
        let outbox = Outbox::default();
        let change = update(project, 10);
        let leave = ClientFrame::PresenceLeave {
            project_id: project,
        };
        for frame in [
            at(project, 1),
            ClientFrame::Ping { id: 1 },
            change.clone(),
            at(project, 2),
            leave.clone(),
            at(project, 3),
            ClientFrame::Ping { id: 2 },
        ] {
            outbox.push(frame);
        }
        assert_eq!(
            outbox.take(),
            vec![change, leave, at(project, 3), ClientFrame::Ping { id: 2 }]
        );
        assert!(outbox.take().is_empty());
    }

    #[test]
    fn one_post_stays_within_the_servers_frame_count_and_body_size() {
        let project = SharedProjectId::new_v7();
        let outbox = Outbox::default();
        for _ in 0..100 {
            outbox.push(update(project, 10));
        }
        assert_eq!(outbox.take().len(), MAX_POSTED_FRAMES);
        assert_eq!(outbox.take().len(), 100 - MAX_POSTED_FRAMES);
        outbox.push(update(project, 5 * 1024 * 1024));
        outbox.push(update(project, 5 * 1024 * 1024));
        assert_eq!(outbox.take().len(), 1);
        assert_eq!(outbox.take().len(), 1);
        assert!(outbox.take().is_empty());
    }

    async fn read_head(stream: &mut tokio::net::TcpStream) {
        let mut head = Vec::new();
        let mut buffer = [0u8; 1024];
        while !head.windows(4).any(|window| window == b"\r\n\r\n") {
            match stream.read(&mut buffer).await {
                Ok(0) | Err(_) => return,
                Ok(read) => head.extend_from_slice(&buffer[..read]),
            }
        }
    }

    async fn gateway(idle: Duration, answer_from: usize) -> (Url, Arc<AtomicUsize>) {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let address = listener.local_addr().expect("address");
        let timeouts = Arc::new(AtomicUsize::new(0));
        let served = Arc::clone(&timeouts);
        let requests = Arc::new(AtomicUsize::new(0));
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                let number = requests.fetch_add(1, Ordering::SeqCst) + 1;
                let served = Arc::clone(&served);
                tokio::spawn(async move {
                    read_head(&mut stream).await;
                    if number >= answer_from {
                        let body = r#"{"cursor":"c.1","frames":[{"type":"pong","id":7}]}"#;
                        let answer = format!(
                            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                            body.len()
                        );
                        let _ = stream.write_all(answer.as_bytes()).await;
                        return;
                    }
                    let mut rest = [0u8; 64];
                    tokio::select! {
                        () = tokio::time::sleep(idle) => {
                            let answer = "HTTP/1.1 504 Gateway Timeout\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
                            if stream.write_all(answer.as_bytes()).await.is_ok() {
                                served.fetch_add(1, Ordering::SeqCst);
                            }
                        }
                        _ = stream.read(&mut rest) => {}
                    }
                });
            }
        });
        let url = Url::parse(&format!("http://{address}/")).expect("gateway address");
        (url, timeouts)
    }

    async fn answering_with(head: &'static str, body_bytes: usize) -> Url {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind");
        let address = listener.local_addr().expect("address");
        tokio::spawn(async move {
            while let Ok((mut stream, _)) = listener.accept().await {
                tokio::spawn(async move {
                    read_head(&mut stream).await;
                    if stream.write_all(head.as_bytes()).await.is_err() {
                        return;
                    }
                    let chunk = vec![b' '; 64 * 1024];
                    let mut sent = 0;
                    while sent < body_bytes {
                        let take = chunk.len().min(body_bytes - sent);
                        if stream.write_all(&chunk[..take]).await.is_err() {
                            return;
                        }
                        sent += take;
                    }
                    let _ = stream.shutdown().await;
                });
            }
        });
        Url::parse(&format!("http://{address}/")).expect("address")
    }

    #[tokio::test]
    async fn an_answer_larger_than_the_limit_is_refused_while_it_is_read() {
        let client = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("client");
        let declared = answering_with(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 4194304\r\nConnection: close\r\n\r\n",
            4 * 1024 * 1024,
        )
        .await;
        let streamed = answering_with(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            4 * 1024 * 1024,
        )
        .await;
        for url in [declared, streamed] {
            let read = answer_within(client.get(url), 1024 * 1024).await;
            assert!(
                matches!(read, Err(CollabError::Network(ref message)) if message.contains("larger than 1 MiB")),
                "{read:?}"
            );
        }
        let small = answering_with(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n",
            1000,
        )
        .await;
        let (status, body) = answer_within(client.get(small), 1024 * 1024)
            .await
            .expect("a small answer");
        assert_eq!((status, body.len()), (200, 1000));
    }

    #[tokio::test]
    async fn a_post_a_proxy_refuses_as_too_large_reads_like_the_servers_own_refusal() {
        let (url, _) = crate::client::test_util::routed(|_| {
            vec![(
                "/frames",
                vec![crate::client::test_util::http_response(
                    "413 Payload Too Large",
                    &[],
                    "",
                )],
            )]
        })
        .await;
        let channel = PollChannel {
            http: reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("client"),
            poll: url.endpoint("poll"),
            frames: url.endpoint("frames"),
            key: "key".to_owned(),
        };
        let outbox = Arc::new(Outbox::default());
        let (sender, mut replies) = mpsc::channel(4);
        let posting = tokio::spawn(post_outbox(channel, Arc::clone(&outbox), sender));
        let project = SharedProjectId::new_v7();
        for _ in 0..2 {
            outbox.push(update(project, 64 * 1024));
            let reply = tokio::time::timeout(Duration::from_secs(10), replies.recv())
                .await
                .expect("an answer")
                .expect("the outbox is still sending");
            assert!(
                matches!(
                    reply.as_deref(),
                    Ok([ServerFrame::Error {
                        code: FrameErrorCode::TooLarge,
                        ..
                    }])
                ),
                "{reply:?}"
            );
        }
        assert!(!posting.is_finished());
        posting.abort();
    }

    #[test]
    fn a_large_post_gets_the_time_a_slow_link_needs() {
        let small = POST_TIMEOUT + upload_allowance(256);
        let large = POST_TIMEOUT + upload_allowance(8 * 1024 * 1024);
        assert!(small < POST_TIMEOUT + Duration::from_secs(1));
        assert_eq!(large, POST_TIMEOUT + Duration::from_secs(512));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn gateway_timeouts_never_end_polling_and_the_wait_shrinks_below_the_gateways() {
        let (url, timeouts) = gateway(Duration::from_millis(600), 5).await;
        let channel = PollChannel {
            http: reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("client"),
            poll: url.join("poll").expect("poll address"),
            frames: url.join("frames").expect("frames address"),
            key: "key".to_owned(),
        };
        let (sender, mut receiver) = mpsc::channel(4);
        let timing = PollTiming {
            longest: Duration::from_secs(5),
            shortest: Duration::from_millis(200),
            retry: Duration::from_millis(20),
            attempts: 3,
        };
        let poller = tokio::spawn(keep_polling(channel, "c.0".to_owned(), sender, timing));
        let polled = tokio::time::timeout(Duration::from_secs(15), receiver.recv())
            .await
            .expect("the poller answered")
            .expect("the poller is still running");
        poller.abort();
        assert_eq!(
            polled.expect("frames, not a failure"),
            vec![ServerFrame::Pong { id: 7 }]
        );
        assert_eq!(timeouts.load(Ordering::SeqCst), 1);
    }
}
