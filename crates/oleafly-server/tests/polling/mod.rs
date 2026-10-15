#![allow(dead_code)]

use std::time::{Duration, Instant};

use oleafly_collab_protocol::auth::{challenge_message, ChallengePurpose};
use oleafly_collab_protocol::capabilities::PROTOCOL_VERSION;
use oleafly_collab_protocol::frames::{ClientFrame, ServerFrame};
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::poll::{
    PollBatch, PollFrames, PollReplies, DEVICE_HEADER, NONCE_HEADER, POLL_KEY_HEADER,
    PROTOCOL_HEADER, SIGNATURE_HEADER,
};
use oleafly_server::test_support::{challenge_nonce, TestDevice, TestServer};
use reqwest::StatusCode;

use crate::people::Person;

const WAIT: Duration = Duration::from_secs(5);

pub struct Poller {
    pub base: String,
    pub project: SharedProjectId,
    pub key: String,
    pub cursor: String,
}

pub fn poll_url(server: &TestServer, project: SharedProjectId) -> String {
    format!("{}/api/v1/projects/{project}/poll", server.url())
}

pub async fn open_with(
    server: &TestServer,
    person: &Person,
    project: SharedProjectId,
    since: u64,
    signer: &TestDevice,
    protocol: u32,
) -> reqwest::Response {
    let nonce = challenge_nonce(server).await;
    let signature = signer.sign_b64(&challenge_message(
        ChallengePurpose::Socket,
        server.state().server_id,
        &nonce,
    ));
    reqwest::Client::new()
        .get(poll_url(server, project))
        .query(&[("since", since.to_string())])
        .bearer_auth(person.token())
        .header(DEVICE_HEADER, person.tokens.device_id.to_string())
        .header(NONCE_HEADER, nonce)
        .header(SIGNATURE_HEADER, signature)
        .header(PROTOCOL_HEADER, protocol.to_string())
        .send()
        .await
        .expect("open request")
}

pub async fn open(
    server: &TestServer,
    person: &Person,
    project: SharedProjectId,
    since: u64,
) -> (Option<Poller>, Vec<ServerFrame>) {
    let response = open_with(
        server,
        person,
        project,
        since,
        &person.device,
        PROTOCOL_VERSION,
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    let batch: PollBatch = response.json().await.expect("poll batch");
    let poller = match (batch.key, batch.cursor) {
        (Some(key), Some(cursor)) => Some(Poller {
            base: server.url(),
            project,
            key,
            cursor,
        }),
        _ => None,
    };
    (poller, batch.frames)
}

pub async fn opened(server: &TestServer, person: &Person, project: SharedProjectId) -> Poller {
    let (poller, frames) = open(server, person, project, 0).await;
    assert!(
        matches!(frames.first(), Some(ServerFrame::Subscribed { .. })),
        "{frames:?}"
    );
    poller.expect("an open session")
}

impl Poller {
    pub async fn get(&self, cursor: &str, key: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(format!(
                "{}/api/v1/projects/{}/poll",
                self.base, self.project
            ))
            .query(&[("cursor", cursor)])
            .header(POLL_KEY_HEADER, key)
            .send()
            .await
            .expect("poll request")
    }

    pub async fn poll_at(&mut self, cursor: &str) -> Vec<ServerFrame> {
        let response = self.get(cursor, &self.key.clone()).await;
        assert_eq!(response.status(), StatusCode::OK);
        let batch: PollBatch = response.json().await.expect("poll batch");
        assert_eq!(batch.key, None);
        if let Some(cursor) = batch.cursor {
            self.cursor = cursor;
        }
        batch.frames
    }

    pub async fn poll(&mut self) -> Vec<ServerFrame> {
        let cursor = self.cursor.clone();
        self.poll_at(&cursor).await
    }

    pub async fn status(&self) -> StatusCode {
        self.get(&self.cursor, &self.key).await.status()
    }

    pub async fn collect(&mut self, count: usize) -> Vec<ServerFrame> {
        let deadline = Instant::now() + WAIT;
        let mut frames = Vec::new();
        while frames.len() < count {
            assert!(Instant::now() < deadline, "only got {frames:?}");
            frames.extend(self.poll().await);
        }
        frames
    }

    pub async fn next(&mut self) -> ServerFrame {
        let mut frames = self.collect(1).await;
        assert_eq!(frames.len(), 1, "{frames:?}");
        frames.remove(0)
    }

    pub async fn post_with(&self, key: &str, frames: Vec<ClientFrame>) -> reqwest::Response {
        reqwest::Client::new()
            .post(format!(
                "{}/api/v1/projects/{}/frames",
                self.base, self.project
            ))
            .header(POLL_KEY_HEADER, key)
            .json(&PollFrames { frames })
            .send()
            .await
            .expect("frames request")
    }

    pub async fn post(&self, frames: Vec<ClientFrame>) -> Vec<ServerFrame> {
        let response = self.post_with(&self.key, frames).await;
        assert_eq!(response.status(), StatusCode::OK);
        let replies: PollReplies = response.json().await.expect("replies");
        replies.frames
    }
}
