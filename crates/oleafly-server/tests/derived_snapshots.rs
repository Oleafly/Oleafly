mod people;

use loro::{ExportMode, LoroDoc};
use oleafly_collab_protocol::crypto::{b64url_decode, verify_ed25519};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::snapshots::{
    snapshot_signing_bytes, SNAPSHOT_DEVICE_HEADER, SNAPSHOT_SIGNATURE_HEADER,
};
use oleafly_server::config::BlobStoreConfig;
use oleafly_server::projects;
use oleafly_server::test_support::{test_config, MockS3, MockS3Fault, TestDevice};
use people::{
    call, connect, create_project, first_snapshot, grant, next_frame, put_bytes, send_update,
    share_project, signed_by, stage, stage_with, subscribe, text_of, Person, Socket, Stage,
    SNAPSHOT_TEXT,
};
use reqwest::{Method, StatusCode};

const SEQ_HEADER: &str = "x-oleafly-snapshot-seq";

fn snapshot_often(stage: &Stage) {
    stage
        .server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: 1,
            keep_updates: 1,
        });
}

async fn shared_with_alice(stage: &Stage) -> SharedProjectId {
    let project = share_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    project
}

struct Writer {
    doc: LoroDoc,
    socket: Socket,
}

impl Writer {
    async fn open(stage: &Stage, person: &Person, project: SharedProjectId) -> Writer {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        let mut socket = connect(&stage.server, person).await;
        assert!(matches!(
            subscribe(&mut socket, project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        Writer { doc, socket }
    }

    async fn type_text(&mut self, person: &Person, project: SharedProjectId, text: &str) -> u64 {
        let before = self.doc.oplog_vv();
        let field = self.doc.get_text("text");
        field.insert(field.len_unicode(), text).expect("insert");
        self.doc.commit();
        let update = self
            .doc
            .export(ExportMode::updates(&before))
            .expect("update");
        send_update(
            &mut self.socket,
            &signed_by(person, &person.device, project, &update),
        )
        .await;
        loop {
            match next_frame(&mut self.socket).await.expect("a reply") {
                ServerFrame::Ack { seq, .. } => return seq,
                ServerFrame::Update { .. } | ServerFrame::Presence { .. } => {}
                other => panic!("the change was not stored: {other:?}"),
            }
        }
    }

    fn text(&self) -> String {
        self.doc.get_text("text").to_string()
    }
}

async fn hint(stage: &Stage, person: &Person, project: SharedProjectId, seq: u64, body: Vec<u8>) {
    let path = format!("/api/v1/projects/{project}/snapshot?seq={seq}");
    assert_eq!(
        put_bytes(&stage.server, &path, person.token(), body)
            .await
            .status(),
        StatusCode::NO_CONTENT
    );
}

async fn download(stage: &Stage, query: &str, project: SharedProjectId) -> reqwest::Response {
    call(
        &stage.server,
        Method::GET,
        &format!("/api/v1/projects/{project}/snapshot{query}"),
        stage.bob.token(),
        None,
    )
    .await
}

fn seq_of(response: &reqwest::Response) -> Option<u64> {
    response
        .headers()
        .get(SEQ_HEADER)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
}

fn sha256(bytes: &[u8]) -> Vec<u8> {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .to_vec()
}

#[tokio::test]
async fn an_editor_cannot_replace_the_snapshot_every_joiner_loads() {
    let stage = stage().await;
    snapshot_often(&stage);
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project).await;
    assert_eq!(
        alice.type_text(&stage.alice, project, " from Alice").await,
        1
    );
    hint(
        &stage,
        &stage.alice,
        project,
        1,
        b"not a loro document".to_vec(),
    )
    .await;
    let served = download(&stage, "", project).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(seq_of(&served), Some(1));
    let bytes = served.bytes().await.expect("body").to_vec();
    assert_ne!(bytes, b"not a loro document");
    assert_eq!(text_of(&bytes), alice.text());

    let evil = LoroDoc::new();
    evil.get_text("text").insert(0, "replaced").expect("insert");
    evil.commit();
    assert_eq!(alice.type_text(&stage.alice, project, " again").await, 2);
    hint(
        &stage,
        &stage.alice,
        project,
        2,
        evil.export(ExportMode::Snapshot).expect("snapshot"),
    )
    .await;
    let bytes = download(&stage, "", project)
        .await
        .bytes()
        .await
        .expect("body")
        .to_vec();
    assert_eq!(text_of(&bytes), format!("{SNAPSHOT_TEXT} from Alice again"));
}

#[tokio::test]
async fn a_long_running_project_compacts_into_snapshots_the_server_builds() {
    let stage = stage().await;
    snapshot_often(&stage);
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project).await;
    let mut texts = vec![String::from(SNAPSHOT_TEXT)];
    for round in 1..=30u64 {
        assert_eq!(
            alice
                .type_text(&stage.alice, project, &format!(" {round}"))
                .await,
            round
        );
        texts.push(alice.text());
    }
    for seq in [10, 20, 30] {
        hint(&stage, &stage.alice, project, seq, Vec::new()).await;
    }
    let newest = download(&stage, "", project).await;
    assert_eq!(seq_of(&newest), Some(30));
    assert_eq!(text_of(&newest.bytes().await.expect("body")), texts[30]);
    let before = download(&stage, "?before=30", project).await;
    assert_eq!(before.status(), StatusCode::OK);
    assert_eq!(seq_of(&before), Some(20));
    assert_eq!(text_of(&before.bytes().await.expect("body")), texts[20]);
    let oldest = stage
        .server
        .state()
        .db
        .call(move |conn| projects::oldest_kept_update(conn, project))
        .await
        .expect("oldest kept");
    assert_eq!(oldest, Some(21));
    let mut joiner = connect(&stage.server, &stage.bob).await;
    assert!(matches!(
        subscribe(&mut joiner, project, 20).await,
        ServerFrame::Subscribed { head_seq: 30, .. }
    ));
    assert!(matches!(
        next_frame(&mut joiner).await,
        Some(ServerFrame::Update { seq: 21, .. })
    ));
}

#[tokio::test]
async fn the_owners_first_snapshot_keeps_its_device_signature() {
    let stage = stage().await;
    let project = create_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let bytes = first_snapshot();
    let signature = stage
        .bob
        .device
        .sign_b64(&snapshot_signing_bytes(project, 0, &sha256(&bytes)));
    let uploaded = reqwest::Client::new()
        .put(format!(
            "{}/api/v1/projects/{project}/snapshot?seq=0",
            stage.server.url()
        ))
        .bearer_auth(stage.bob.token())
        .header(SNAPSHOT_SIGNATURE_HEADER, &signature)
        .body(bytes.clone())
        .send()
        .await
        .expect("upload");
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let served = download(&stage, "", project).await;
    assert_eq!(served.status(), StatusCode::OK);
    let device = served
        .headers()
        .get(SNAPSHOT_DEVICE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let signed = served
        .headers()
        .get(SNAPSHOT_SIGNATURE_HEADER)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    assert_eq!(device, Some(stage.bob.tokens.device_id.to_string()));
    let body = served.bytes().await.expect("body").to_vec();
    assert_eq!(body, bytes);
    let key = b64url_decode(stage.bob.device.public_key_b64()).expect("key");
    let signature = b64url_decode(&signed.expect("a signature")).expect("signature");
    assert!(verify_ed25519(
        &key,
        &snapshot_signing_bytes(project, 0, &sha256(&body)),
        &signature
    ));
}

#[tokio::test]
async fn a_first_snapshot_that_is_badly_signed_or_not_a_document_is_refused() {
    let stage = stage().await;
    let project = create_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let bytes = first_snapshot();
    let thief = TestDevice::generate();
    let forged = thief.sign_b64(&snapshot_signing_bytes(project, 0, &sha256(&bytes)));
    let url = format!(
        "{}/api/v1/projects/{project}/snapshot?seq=0",
        stage.server.url()
    );
    let refused = reqwest::Client::new()
        .put(&url)
        .bearer_auth(stage.bob.token())
        .header(SNAPSHOT_SIGNATURE_HEADER, &forged)
        .body(bytes)
        .send()
        .await
        .expect("upload");
    assert_eq!(refused.status(), StatusCode::BAD_REQUEST);
    let garbage = put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{project}/snapshot?seq=0"),
        stage.bob.token(),
        b"first snapshot".to_vec(),
    )
    .await;
    assert_eq!(garbage.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        download(&stage, "", project).await.status(),
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn everyone_closing_at_once_leaves_one_snapshot_the_server_built() {
    let stage = stage().await;
    snapshot_often(&stage);
    let project = shared_with_alice(&stage).await;
    let mut alice = Writer::open(&stage, &stage.alice, project).await;
    for round in 1..=3u64 {
        alice
            .type_text(&stage.alice, project, &format!(" {round}"))
            .await;
    }
    let url = format!(
        "{}/api/v1/projects/{project}/snapshot?seq=3",
        stage.server.url()
    );
    let replies = futures_util::future::join_all((0..6).map(|person| {
        let token = if person % 2 == 0 {
            stage.alice.token().to_owned()
        } else {
            stage.bob.token().to_owned()
        };
        let url = url.clone();
        async move {
            reqwest::Client::new()
                .put(url)
                .bearer_auth(token)
                .body(format!("closed by person {person}"))
                .send()
                .await
                .expect("hint")
        }
    }))
    .await;
    for reply in &replies {
        assert_eq!(reply.status(), StatusCode::NO_CONTENT);
        assert_eq!(seq_of(reply), Some(3));
    }
    let project_rows = stage
        .server
        .state()
        .db
        .call(move |conn| projects::snapshots(conn, project))
        .await
        .expect("rows");
    let seqs: Vec<u64> = project_rows.iter().map(|row| row.seq).collect();
    assert_eq!(seqs, vec![3, 0]);
    let bytes = download(&stage, "", project)
        .await
        .bytes()
        .await
        .expect("body")
        .to_vec();
    assert_eq!(text_of(&bytes), alice.text());
}

#[tokio::test]
async fn the_device_that_signed_the_first_snapshot_stays_listed_after_it_signs_out() {
    let stage = stage().await;
    let project = create_project(&stage.server, &stage.bob, "Thesis")
        .await
        .project_id;
    let bytes = first_snapshot();
    let signature = stage
        .bob
        .device
        .sign_b64(&snapshot_signing_bytes(project, 0, &sha256(&bytes)));
    let uploaded = reqwest::Client::new()
        .put(format!(
            "{}/api/v1/projects/{project}/snapshot?seq=0",
            stage.server.url()
        ))
        .bearer_auth(stage.bob.token())
        .header(SNAPSHOT_SIGNATURE_HEADER, &signature)
        .body(bytes)
        .send()
        .await
        .expect("upload");
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let commit = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{project}/commit"),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(commit.status(), StatusCode::OK);
    assert_eq!(
        grant(
            &stage.server,
            &stage.bob,
            project,
            &stage.alice,
            ProjectRole::Editor
        )
        .await
        .status(),
        StatusCode::OK
    );
    let device = stage.bob.tokens.device_id;
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE devices SET revoked_at = 1 WHERE id = ?1",
                [device.to_string()],
            )?;
            Ok(())
        })
        .await
        .expect("sign the laptop out");
    let listed: Vec<oleafly_collab_protocol::projects::ProjectDevice> = people::read(
        call(
            &stage.server,
            Method::GET,
            &format!("/api/v1/projects/{project}/devices"),
            stage.alice.token(),
            None,
        )
        .await,
    )
    .await;
    assert!(listed.iter().any(|listed| listed.device_id == device));
}

async fn append_changes(
    stage: &Stage,
    doc: &LoroDoc,
    project: SharedProjectId,
    from: u64,
    through: u64,
) {
    let person = &stage.alice;
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    let mut stored = Vec::new();
    for round in from..=through {
        let before = doc.oplog_vv();
        let field = doc.get_text("text");
        field
            .insert(field.len_unicode(), &format!(" {round}"))
            .expect("insert");
        doc.commit();
        let update = doc.export(ExportMode::updates(&before)).expect("update");
        let envelope = signed_by(person, &person.device, project, &update);
        stored.push((
            envelope.batch_id,
            serde_json::to_vec(&envelope).expect("json"),
            update,
        ));
    }
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            for (batch, envelope, update) in stored {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &envelope, 1)?;
            }
            Ok(())
        })
        .await
        .expect("append changes");
}

async fn append_large_changes(stage: &Stage, doc: &LoroDoc, project: SharedProjectId, count: u64) {
    let person = &stage.alice;
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    let paragraph = "A paragraph that a lab keeps rewriting while the server builds. ".repeat(24);
    let mut stored = Vec::new();
    let mut state = 0x2545_F491_4F6C_DD1Du64;
    for _ in 0..count {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        let before = doc.oplog_vv();
        let field = doc.get_text("text");
        let length = field.len_unicode();
        let at = usize::try_from(state % (length as u64 + 1)).unwrap_or(0);
        field.insert(at, &paragraph).expect("insert");
        if length > 4_000 {
            let from = usize::try_from((state >> 20) % (length as u64 - 2_000)).unwrap_or(0);
            field.delete(from, 1_000).expect("delete");
        }
        doc.commit();
        let update = doc.export(ExportMode::updates(&before)).expect("update");
        let envelope = signed_by(person, &person.device, project, &update);
        stored.push((
            envelope.batch_id,
            serde_json::to_vec(&envelope).expect("json"),
            update,
        ));
    }
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            for (batch, envelope, update) in stored {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &envelope, 1)?;
            }
            Ok(())
        })
        .await
        .expect("append changes");
}

fn next_random(state: &mut u64) -> u64 {
    *state ^= *state << 13;
    *state ^= *state >> 7;
    *state ^= *state << 17;
    *state
}

fn concurrent_lab_changes(rounds: usize) -> (String, Vec<Vec<u8>>) {
    let writers: Vec<LoroDoc> = (0..6u64)
        .map(|index| {
            let doc = LoroDoc::new();
            doc.import(&first_snapshot())
                .expect("the first snapshot loads");
            doc.set_peer_id(500 + index).expect("peer");
            doc
        })
        .collect();
    let mut state = 0x9E37_79B9_7F4A_7C15u64;
    let mut log = Vec::new();
    let mut unseen: Vec<Vec<Vec<u8>>> = vec![Vec::new(); writers.len()];
    for round in 0..rounds {
        let who = usize::try_from(next_random(&mut state) % 6).unwrap_or(0);
        let doc = &writers[who];
        let before = doc.oplog_vv();
        let field = doc.get_text("text");
        let length = field.len_unicode();
        let at = usize::try_from(next_random(&mut state) % (length as u64 + 1)).unwrap_or(0);
        field
            .insert(
                at,
                "a line someone typed in the shared file\nand the next line\n",
            )
            .expect("insert");
        if length > 20_000 {
            let from =
                usize::try_from(next_random(&mut state) % (length as u64 - 200)).unwrap_or(0);
            field.delete(from, 90).expect("delete");
        }
        doc.commit();
        let update = doc.export(ExportMode::updates(&before)).expect("update");
        for (other, queue) in unseen.iter_mut().enumerate() {
            if other != who {
                queue.push(update.clone());
            }
        }
        log.push(update);
        if round % 8 == 0 {
            let catching = usize::try_from(next_random(&mut state) % 6).unwrap_or(0);
            let queued = std::mem::take(&mut unseen[catching]);
            writers[catching].import_batch(&queued).expect("catch up");
        }
    }
    let merged = LoroDoc::new();
    merged.import(&first_snapshot()).expect("base");
    merged.import_batch(&log).expect("everything");
    (merged.get_text("text").to_string(), log)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_snapshot_of_many_people_typing_at_once_is_built_in_one_quick_pass() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let (expected, log) = concurrent_lab_changes(400);
    let person = &stage.alice;
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    let stored: Vec<_> = log
        .iter()
        .map(|update| {
            let envelope = signed_by(person, &person.device, project, update);
            (
                envelope.batch_id,
                serde_json::to_vec(&envelope).expect("json"),
                update.clone(),
            )
        })
        .collect();
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            for (batch, envelope, update) in stored {
                let reach = oleafly_server::peers::update_reach(&update).expect("a change");
                oleafly_server::peers::bind(conn, project, device, account, &reach, 1)?;
                projects::append_update(conn, project, batch, device, account, &envelope, 1)?;
            }
            Ok(())
        })
        .await
        .expect("append changes");
    stage
        .server
        .state()
        .snapshots
        .set_policy(oleafly_server::snapshots::Policy {
            build_after: 200,
            keep_updates: 2_000,
        });
    let one_by_one = one_change_at_a_time(log.clone()).await;
    let started = std::time::Instant::now();
    assert_eq!(hinted(&stage, project, 400).await, Some(400));
    let built_in = started.elapsed();
    assert!(
        built_in * 3 < one_by_one,
        "building the snapshot took {built_in:?}, importing the same changes one at a time took {one_by_one:?}"
    );
    let newest = download(&stage, "", project).await;
    assert_eq!(text_of(&newest.bytes().await.expect("body")), expected);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn changes_are_acknowledged_quickly_while_a_large_snapshot_is_built() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    append_large_changes(&stage, &doc, project, 1_500).await;
    let mut bob = Writer::open(&stage, &stage.bob, project).await;
    bob.type_text(&stage.bob, project, " ready").await;
    let started = std::time::Instant::now();
    let server = stage.server.url();
    let token = stage.alice.token().to_owned();
    let building = tokio::spawn(async move {
        let response = reqwest::Client::new()
            .put(format!(
                "{server}/api/v1/projects/{project}/snapshot?seq=1500"
            ))
            .bearer_auth(token)
            .send()
            .await
            .expect("hint");
        (response.status(), started.elapsed())
    });
    let mut slowest = std::time::Duration::ZERO;
    let mut during = 0u32;
    while !building.is_finished() {
        let sent = std::time::Instant::now();
        bob.type_text(&stage.bob, project, " typing").await;
        slowest = slowest.max(sent.elapsed());
        during += 1;
    }
    let (status, built_in) = building.await.expect("the build finishes");
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert!(
        during >= 3,
        "the build took {built_in:?}, too short to overlap any change"
    );
    assert!(
        slowest < built_in / 3,
        "a change waited {slowest:?} for its acknowledgement while the snapshot was built in {built_in:?}"
    );
}

async fn one_change_at_a_time(log: Vec<Vec<u8>>) -> std::time::Duration {
    tokio::task::spawn_blocking(move || {
        let doc = LoroDoc::new();
        doc.import(&first_snapshot())
            .expect("the first snapshot loads");
        let started = std::time::Instant::now();
        for update in &log {
            doc.import(update).expect("a logged change imports");
        }
        started.elapsed()
    })
    .await
    .expect("the import finishes")
}

async fn hinted(stage: &Stage, project: SharedProjectId, seq: u64) -> Option<u64> {
    let response = put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{project}/snapshot?seq={seq}"),
        stage.alice.token(),
        Vec::new(),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    seq_of(&response)
}

#[tokio::test]
async fn a_change_the_server_cannot_read_keeps_the_log_instead_of_a_snapshot_without_it() {
    let stage = stage().await;
    snapshot_often(&stage);
    let project = shared_with_alice(&stage).await;
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    append_changes(&stage, &doc, project, 1, 3).await;
    let hidden = doc.fork();
    hidden.set_peer_id(9_009).expect("peer");
    hidden
        .get_text("text")
        .insert(0, "never stored ")
        .expect("insert");
    hidden.commit();
    let before = hidden.oplog_vv();
    hidden
        .get_text("text")
        .insert(0, "after it ")
        .expect("insert");
    hidden.commit();
    let unreadable = hidden.export(ExportMode::updates(&before)).expect("update");
    let person = &stage.alice;
    let envelope = signed_by(person, &person.device, project, &unreadable);
    let (device, account) = (person.tokens.device_id, person.tokens.account_id);
    stage
        .server
        .state()
        .db
        .call(move |conn| {
            let stored = serde_json::to_vec(&envelope).expect("json");
            projects::append_update(
                conn,
                project,
                envelope.batch_id,
                device,
                account,
                &stored,
                1,
            )
            .map(|_| ())
        })
        .await
        .expect("store the change directly");
    assert_eq!(hinted(&stage, project, 4).await, Some(0));
    let kept = stage
        .server
        .state()
        .db
        .call(move |conn| projects::oldest_kept_update(conn, project))
        .await
        .expect("oldest kept");
    assert_eq!(kept, Some(1));
    let (seq, bytes) = {
        let response = download(&stage, "", project).await;
        (seq_of(&response), response.bytes().await.expect("body"))
    };
    assert_eq!(seq, Some(0));
    assert_eq!(text_of(&bytes), SNAPSHOT_TEXT);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn a_hint_the_app_gives_up_on_still_builds_the_snapshot() {
    let mock = MockS3::start().await;
    let mut config = test_config();
    config.blob_store = BlobStoreConfig::S3(Box::new(mock.config("oleafly")));
    let stage = stage_with(config).await;
    snapshot_often(&stage);
    let project = shared_with_alice(&stage).await;
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    append_changes(&stage, &doc, project, 1, 3).await;
    mock.set_fault(Some(MockS3Fault::Stall(std::time::Duration::from_secs(1))));
    let gave_up = reqwest::Client::new()
        .put(format!(
            "{}/api/v1/projects/{project}/snapshot?seq=3",
            stage.server.url()
        ))
        .bearer_auth(stage.alice.token())
        .timeout(std::time::Duration::from_millis(500))
        .body(Vec::new())
        .send()
        .await;
    assert!(gave_up.is_err(), "the slow build answered in time");
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let newest = stage
            .server
            .state()
            .db
            .call(move |conn| projects::latest_snapshot(conn, project))
            .await
            .expect("the newest snapshot")
            .map(|row| row.seq);
        if newest == Some(3) {
            break;
        }
        assert!(
            tokio::time::Instant::now() < deadline,
            "the build stopped with the request, newest is {newest:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    mock.set_fault(None);
    let response = download(&stage, "", project).await;
    assert_eq!(seq_of(&response), Some(3));
    assert_eq!(
        text_of(&response.bytes().await.expect("body")),
        doc.get_text("text").to_string()
    );
}

async fn catches_up_from_the_log(stage: &Stage, project: SharedProjectId, since: u64) {
    let mut late = connect(&stage.server, &stage.bob).await;
    let opened = subscribe(&mut late, project, since).await;
    assert!(
        matches!(opened, ServerFrame::Subscribed { .. }),
        "a device at {since} was sent {opened:?}"
    );
    assert!(matches!(
        next_frame(&mut late).await,
        Some(ServerFrame::Update { seq, .. }) if seq == since + 1
    ));
}

#[tokio::test]
async fn a_device_a_few_dozen_changes_behind_after_several_closes_catches_up_from_the_log() {
    let stage = stage().await;
    let project = shared_with_alice(&stage).await;
    let doc = LoroDoc::new();
    doc.import(&first_snapshot())
        .expect("the first snapshot loads");
    append_changes(&stage, &doc, project, 1, 1_000).await;
    assert_eq!(hinted(&stage, project, 1_000).await, Some(1_000));
    append_changes(&stage, &doc, project, 1_001, 1_040).await;
    assert_eq!(hinted(&stage, project, 1_040).await, Some(1_000));
    append_changes(&stage, &doc, project, 1_041, 1_080).await;
    assert_eq!(hinted(&stage, project, 1_080).await, Some(1_000));
    catches_up_from_the_log(&stage, project, 1_010).await;
    append_changes(&stage, &doc, project, 1_081, 2_000).await;
    assert_eq!(hinted(&stage, project, 2_000).await, Some(2_000));
    append_changes(&stage, &doc, project, 2_001, 3_000).await;
    assert_eq!(hinted(&stage, project, 3_000).await, Some(3_000));
    catches_up_from_the_log(&stage, project, 1_010).await;
    let kept = stage
        .server
        .state()
        .db
        .call(move |conn| projects::snapshots(conn, project))
        .await
        .expect("rows");
    let seqs: Vec<u64> = kept.iter().map(|row| row.seq).collect();
    assert_eq!(seqs, vec![3_000, 2_000, 1_000]);
    let newest = download(&stage, "", project).await;
    assert_eq!(seq_of(&newest), Some(3_000));
    assert_eq!(
        text_of(&newest.bytes().await.expect("body")),
        doc.get_text("text").to_string()
    );
}
