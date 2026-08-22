use std::{net::SocketAddr, time::Duration};

use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use oleafly_realtime_protocol::{
    apply_update_v1, authoring_doc, decode_server_to_client_frame_v1,
    encode_client_to_server_frame_v1, snapshot_authoring_doc_v1, ActorId, AiAssistanceReceipt,
    ClientToServerFrameV1, ClientToServerMessageV1, ClientUpdateId, EditSessionId,
    MutationEnvelopeV1, MutationOrigin, OpeningAuthV1, ReplicaId, ServerToClientMessageV1,
    SharedProjectId, REALTIME_PROTOCOL_VERSION,
};
use oleafly_realtime_server::{
    router, storage::Storage, AppState, RuntimeMode, ServerConfig, ServerLimits,
};
use serde::Deserialize;
use tokio::{
    net::TcpListener,
    task::JoinHandle,
    time::{sleep, timeout},
};
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use url::Url;
use uuid::Uuid;
use yrs::{updates::encoder::Encode, ReadTxn, Transact};

type TestSocket = WebSocketStream<MaybeTlsStream<tokio::net::TcpStream>>;

const DEV_TOKEN: &str = "only-for-loopback-e2e";
const SETUP_TOKEN: &str = "one-time-production-setup-token";
const LOCAL_PASSWORD: &str = "correct horse battery staple";
const MASTER_KEY: [u8; 32] = [42; 32];
const PRIVATE_ACCEPTED_DIFF: &str = "PRIVATE-AI-DIFF-8f28c468";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bootstrap {
    project_id: SharedProjectId,
    clients: Vec<BootstrapClient>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct BootstrapClient {
    actor_id: ActorId,
    replica_id: ReplicaId,
    ticket: String,
}

#[derive(Deserialize)]
struct AuthoringFixture {
    #[serde(rename = "yjsUpdateV1Base64")]
    yjs_update_v1_base64: String,
}

#[derive(Deserialize)]
struct TicketResponse {
    ticket: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionBootstrapResponse {
    actor_id: ActorId,
    project_id: SharedProjectId,
    username: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LoginResponse {
    access_token: String,
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore = "requires OLEAFLY_REALTIME_TEST_DATABASE_URL; see deploy/realtime/README.md"]
async fn two_clients_durable_edits_presence_idempotency_and_restart_recovery() -> Result<()> {
    let _ = tracing_subscriber::fmt()
        .with_env_filter("oleafly_realtime_server=debug")
        .with_test_writer()
        .try_init();
    let database_url = std::env::var("OLEAFLY_REALTIME_TEST_DATABASE_URL")
        .context("OLEAFLY_REALTIME_TEST_DATABASE_URL is required")?;
    let storage = Storage::connect(&database_url, MASTER_KEY).await?;
    storage.migrate().await?;
    sqlx::query(
        "TRUNCATE TABLE realtime_instance, access_tokens, local_accounts, sync_tickets, authoring_snapshots, authoring_journal, project_memberships, projects, actors CASCADE",
    )
    .execute(storage.pool())
    .await?;

    let (address, server) = spawn_server(database_url.clone()).await?;
    let http_base = format!("http://{address}");
    let client = reqwest::Client::new();
    assert_eq!(
        client
            .get(format!("{http_base}/ready"))
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NO_CONTENT
    );
    let bootstrap = client
        .post(format!("{http_base}/v1/dev/bootstrap"))
        .bearer_auth(DEV_TOKEN)
        .send()
        .await?
        .error_for_status()?
        .json::<Bootstrap>()
        .await?;
    assert_eq!(bootstrap.clients.len(), 2);

    let project_id = bootstrap.project_id;
    let alice = &bootstrap.clients[0];
    let bob = &bootstrap.clients[1];
    let mut socket_a = open_client(address, project_id, &alice.ticket).await?;
    let mut socket_b = open_client(address, project_id, &bob.ticket).await?;

    let capped_ticket = client
        .post(format!("{http_base}/v1/dev/projects/{project_id}/tickets"))
        .bearer_auth(DEV_TOKEN)
        .json(&serde_json::json!({
            "actorId": bob.actor_id,
            "replicaId": bob.replica_id,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<TicketResponse>()
        .await?;
    let capped_connection = open_client(address, project_id, &capped_ticket.ticket).await;
    assert!(capped_connection.is_err());

    // Both replicas reconcile the same initially empty room before editing.
    reconcile_empty(&mut socket_a).await?;
    reconcile_empty(&mut socket_b).await?;

    let fixture: AuthoringFixture = serde_json::from_str(include_str!(
        "../../../fixtures/realtime/authoring-doc-v1.json"
    ))?;
    let update = STANDARD.decode(fixture.yjs_update_v1_base64)?;
    let mutation = MutationEnvelopeV1 {
        client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
        replica_id: alice.replica_id,
        client_sequence: 1,
        edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
        origin: MutationOrigin::Human,
        assistance: Some(AiAssistanceReceipt {
            provider: "private-provider".to_owned(),
            model: "private-model".to_owned(),
            proposal_identifier: "proposal-1".to_owned(),
            accepted_diff: PRIVATE_ACCEPTED_DIFF.to_owned(),
        }),
        update: update.clone(),
    };
    send_client_message(
        &mut socket_a,
        ClientToServerMessageV1::Mutation(mutation.clone()),
    )
    .await?;

    let receipt = receive_matching(&mut socket_a, |message| {
        matches!(message, ServerToClientMessageV1::DurableReceipt(value) if value.client_update_id == mutation.client_update_id)
    })
    .await?;
    let ServerToClientMessageV1::DurableReceipt(receipt) = receipt else {
        unreachable!()
    };
    // Observing the row from a separate pool after the receipt proves the transaction committed
    // before the server emitted that receipt.
    let committed_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM authoring_journal WHERE project_id = $1 AND client_update_id = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(*mutation.client_update_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(committed_rows, 1);
    let assistance_column_count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'authoring_journal' AND column_name = 'assistance'",
    )
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(assistance_column_count, 0);
    let stored_row: String = sqlx::query_scalar(
        "SELECT to_jsonb(j)::text FROM authoring_journal j WHERE project_id = $1 AND client_update_id = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(*mutation.client_update_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert!(!stored_row.contains(PRIVATE_ACCEPTED_DIFF));
    assert!(!stored_row.contains("private-provider"));
    let snapshot_watermark: i64 = sqlx::query_scalar(
        "SELECT through_server_sequence FROM authoring_snapshots WHERE project_id = $1",
    )
    .bind(*project_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(snapshot_watermark, 1);

    let broadcast = receive_matching(&mut socket_b, |message| {
        matches!(message, ServerToClientMessageV1::YjsSync(sync) if sync.kind == oleafly_realtime_protocol::ServerYjsSyncKindV1::Broadcast)
    })
    .await?;
    let ServerToClientMessageV1::YjsSync(broadcast) = broadcast else {
        unreachable!()
    };
    assert_eq!(broadcast.payload, update);
    let bob_doc = authoring_doc();
    apply_update_v1(&bob_doc, &broadcast.payload)?;
    assert!(snapshot_authoring_doc_v1(&bob_doc)?
        .nodes
        .iter()
        .any(|node| format!("{node:?}").contains("Hello 🌿")));

    // Replaying the original envelope gets the original receipt and no second broadcast.
    send_client_message(
        &mut socket_a,
        ClientToServerMessageV1::Mutation(mutation.clone()),
    )
    .await?;
    let duplicate = receive_matching(&mut socket_a, |message| {
        matches!(message, ServerToClientMessageV1::DurableReceipt(value) if value.client_update_id == mutation.client_update_id)
    })
    .await?;
    let ServerToClientMessageV1::DurableReceipt(duplicate) = duplicate else {
        unreachable!()
    };
    assert_eq!(duplicate.server_sequence, receipt.server_sequence);
    assert!(timeout(Duration::from_millis(250), socket_b.next())
        .await
        .is_err());
    let committed_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM authoring_journal WHERE project_id = $1 AND client_update_id = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(*mutation.client_update_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(committed_rows, 1);

    // This checked-in frame contains genuine Yjs relative-position bytes. The server ignores any
    // attempted client identity and stamps Alice's actor and replica from her one-use ticket.
    let presence_frame =
        STANDARD.decode("T0xSVAEAASAAAAAhAQGYzzUAAHAAgAAAAAAAAAIAAAAEAGUQAAAAAAQAZSAA")?;
    socket_a
        .send(Message::Binary(presence_frame.clone().into()))
        .await?;
    let presence = receive_matching(&mut socket_b, |message| {
        matches!(message, ServerToClientMessageV1::ServerPresence(value) if value.selection.is_some())
    })
    .await?;
    let ServerToClientMessageV1::ServerPresence(presence) = presence else {
        unreachable!()
    };
    assert_eq!(presence.actor_id, alice.actor_id);
    assert_eq!(presence.replica_id, alice.replica_id);
    assert!(presence.selection.is_some());

    // A malformed frame exits through the same unconditional cleanup path as revocation and I/O
    // errors. Bob must not retain Alice's last selection.
    socket_a.send(Message::Binary(vec![0].into())).await?;
    let cleared = receive_matching(&mut socket_b, |message| {
        matches!(message, ServerToClientMessageV1::ServerPresence(value) if value.actor_id == alice.actor_id && value.selection.is_none())
    })
    .await?;
    assert!(matches!(
        cleared,
        ServerToClientMessageV1::ServerPresence(_)
    ));

    // Reconnect Alice, submit a second durable envelope, and immediately drop the sender. The
    // collaborator broadcast is enqueued after commit but before any receipt write to Alice.
    let reconnect_ticket = client
        .post(format!("{http_base}/v1/dev/projects/{project_id}/tickets"))
        .bearer_auth(DEV_TOKEN)
        .json(&serde_json::json!({
            "actorId": alice.actor_id,
            "replicaId": alice.replica_id,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<TicketResponse>()
        .await?;
    let mut disconnected_sender =
        open_client(address, project_id, &reconnect_ticket.ticket).await?;
    let second_mutation = MutationEnvelopeV1 {
        client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
        replica_id: alice.replica_id,
        client_sequence: 2,
        edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
        origin: MutationOrigin::Human,
        assistance: None,
        update: update.clone(),
    };
    send_client_message(
        &mut disconnected_sender,
        ClientToServerMessageV1::Mutation(second_mutation.clone()),
    )
    .await?;
    drop(disconnected_sender);
    let post_disconnect_broadcast = receive_matching(&mut socket_b, |message| {
        matches!(message, ServerToClientMessageV1::YjsSync(sync) if sync.kind == oleafly_realtime_protocol::ServerYjsSyncKindV1::Broadcast)
    })
    .await?;
    let ServerToClientMessageV1::YjsSync(post_disconnect_broadcast) = post_disconnect_broadcast
    else {
        unreachable!()
    };
    assert_eq!(post_disconnect_broadcast.payload, update);
    // Alice's failed receipt write must not retain the room ordering guard. Bob's next mutation
    // reaches a durable receipt without waiting for Alice's dead/non-reading sender.
    let bob_mutation = MutationEnvelopeV1 {
        client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
        replica_id: bob.replica_id,
        client_sequence: 1,
        edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
        origin: MutationOrigin::Human,
        assistance: None,
        update: update.clone(),
    };
    send_client_message(
        &mut socket_b,
        ClientToServerMessageV1::Mutation(bob_mutation.clone()),
    )
    .await?;
    timeout(
        Duration::from_secs(1),
        receive_matching(&mut socket_b, |message| {
            matches!(message, ServerToClientMessageV1::DurableReceipt(value) if value.client_update_id == bob_mutation.client_update_id)
        }),
    )
    .await
    .context("next editor mutation stalled behind failed sender")??;
    let journal_count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM authoring_journal WHERE project_id = $1")
            .bind(*project_id.as_uuid())
            .fetch_one(storage.pool())
            .await?;
    assert_eq!(journal_count, 3);
    // Sequence two is intentionally a journal tail after the sequence-one hot snapshot.
    let snapshot_watermark: i64 = sqlx::query_scalar(
        "SELECT max(through_server_sequence) FROM authoring_snapshots WHERE project_id = $1",
    )
    .bind(*project_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(snapshot_watermark, 1);

    let ciphertext: Vec<u8> = sqlx::query_scalar(
        "SELECT envelope_ciphertext FROM authoring_journal WHERE project_id = $1 AND server_sequence = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(i64::try_from(receipt.server_sequence)?)
    .fetch_one(storage.pool())
    .await?;
    assert_ne!(ciphertext, update);
    assert!(!ciphertext
        .windows(update.len())
        .any(|window| window == update));

    // Drop all in-memory Yrs state, reconstruct a new server from PostgreSQL, and reconcile a fresh
    // replica. The acknowledged text must still be exact.
    server.abort();
    let _ = server.await;
    drop(socket_b);
    let (restart_address, restarted_server) = spawn_server(database_url.clone()).await?;
    let new_ticket = client
        .post(format!(
            "http://{restart_address}/v1/dev/projects/{project_id}/tickets"
        ))
        .bearer_auth(DEV_TOKEN)
        .json(&serde_json::json!({
            "actorId": bob.actor_id,
            "replicaId": bob.replica_id,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<TicketResponse>()
        .await?;
    let mut recovered_socket = open_client(restart_address, project_id, &new_ticket.ticket).await?;
    let recovered_doc = authoring_doc();
    let state_vector = recovered_doc.transact().state_vector().encode_v1();
    send_client_message(
        &mut recovered_socket,
        ClientToServerMessageV1::StateVectorRequest(
            oleafly_realtime_protocol::ClientStateVectorRequestV1 {
                payload: state_vector,
            },
        ),
    )
    .await?;
    let recovered = receive_matching(&mut recovered_socket, |message| {
        matches!(message, ServerToClientMessageV1::YjsSync(sync) if sync.kind == oleafly_realtime_protocol::ServerYjsSyncKindV1::SyncUpdate)
    })
    .await?;
    let ServerToClientMessageV1::YjsSync(recovered) = recovered else {
        unreachable!()
    };
    apply_update_v1(&recovered_doc, &recovered.payload)?;
    assert_eq!(
        snapshot_authoring_doc_v1(&recovered_doc)?,
        snapshot_authoring_doc_v1(&bob_doc)?
    );

    // A live session whose membership epoch changes is terminated on its next authoring request,
    // and its presence is cleared for peers.
    let alice_restart_ticket = client
        .post(format!(
            "http://{restart_address}/v1/dev/projects/{project_id}/tickets"
        ))
        .bearer_auth(DEV_TOKEN)
        .json(&serde_json::json!({
            "actorId": alice.actor_id,
            "replicaId": alice.replica_id,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<TicketResponse>()
        .await?;
    let mut revoked_socket =
        open_client(restart_address, project_id, &alice_restart_ticket.ticket).await?;
    revoked_socket
        .send(Message::Binary(presence_frame.into()))
        .await?;
    receive_matching(&mut recovered_socket, |message| {
        matches!(message, ServerToClientMessageV1::ServerPresence(value) if value.actor_id == alice.actor_id && value.selection.is_some())
    })
    .await?;
    let mut revocation = storage.pool().begin().await?;
    sqlx::query(
        "UPDATE project_memberships SET authorization_epoch = authorization_epoch + 1 WHERE project_id = $1 AND actor_id = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(*alice.actor_id.as_uuid())
    .execute(&mut *revocation)
    .await?;
    let revoked_mutation = MutationEnvelopeV1 {
        client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
        replica_id: alice.replica_id,
        client_sequence: 3,
        edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
        origin: MutationOrigin::Human,
        assistance: None,
        update: update.clone(),
    };
    send_client_message(
        &mut revoked_socket,
        ClientToServerMessageV1::Mutation(revoked_mutation.clone()),
    )
    .await?;
    // Let the mutation pass its outer session check and reach the membership lock, then make the
    // already-started revocation the first durable operation.
    sleep(Duration::from_millis(100)).await;
    revocation.commit().await?;
    receive_matching(&mut recovered_socket, |message| {
        matches!(message, ServerToClientMessageV1::ServerPresence(value) if value.actor_id == alice.actor_id && value.selection.is_none())
    })
    .await?;
    let revoked_rows: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM authoring_journal WHERE project_id = $1 AND client_update_id = $2",
    )
    .bind(*project_id.as_uuid())
    .bind(*revoked_mutation.client_update_id.as_uuid())
    .fetch_one(storage.pool())
    .await?;
    assert_eq!(revoked_rows, 0);
    restarted_server.abort();

    // The production-only slice can bootstrap once, log in with Argon2id credentials, issue two
    // membership-scoped one-use tickets, and connect two replicas without any dev route.
    let (production_address, production_server) =
        spawn_production_server(database_url.clone()).await?;
    let production_base = format!("http://{production_address}");
    assert_eq!(
        client
            .post(format!("{production_base}/v1/dev/bootstrap"))
            .bearer_auth(DEV_TOKEN)
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );
    for _ in 0..4 {
        assert_eq!(
            client
                .post(format!("{production_base}/v1/setup/bootstrap"))
                .bearer_auth("invalid-high-entropy-setup-bearer")
                .json(&serde_json::json!({
                    "username": "recovery-owner",
                    "password": LOCAL_PASSWORD,
                    "displayName": "Recovery Owner",
                }))
                .send()
                .await?
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
    }
    let production_bootstrap = client
        .post(format!("{production_base}/v1/setup/bootstrap"))
        .bearer_auth(SETUP_TOKEN)
        .json(&serde_json::json!({
            "username": "recovery-owner",
            "password": LOCAL_PASSWORD,
            "displayName": "Recovery Owner",
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<ProductionBootstrapResponse>()
        .await?;
    assert_eq!(production_bootstrap.username, "recovery-owner");
    let stored_password_hash: String =
        sqlx::query_scalar("SELECT password_hash FROM local_accounts WHERE actor_id = $1")
            .bind(*production_bootstrap.actor_id.as_uuid())
            .fetch_one(storage.pool())
            .await?;
    assert!(stored_password_hash.starts_with("$argon2id$"));
    assert!(!stored_password_hash.contains(LOCAL_PASSWORD));
    assert_eq!(
        client
            .post(format!("{production_base}/v1/setup/bootstrap"))
            .bearer_auth(SETUP_TOKEN)
            .json(&serde_json::json!({
                "username": "second-owner",
                "password": LOCAL_PASSWORD,
                "displayName": "Second Owner",
            }))
            .send()
            .await?
            .status(),
        reqwest::StatusCode::NOT_FOUND
    );
    let login = client
        .post(format!("{production_base}/v1/auth/local/login"))
        .json(&serde_json::json!({
            "username": "recovery-owner",
            "password": LOCAL_PASSWORD,
        }))
        .send()
        .await?
        .error_for_status()?
        .json::<LoginResponse>()
        .await?;
    let raw_access_token =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&login.access_token)?;
    let stored_access_token_hash: Vec<u8> =
        sqlx::query_scalar("SELECT token_hash FROM access_tokens WHERE actor_id = $1")
            .bind(*production_bootstrap.actor_id.as_uuid())
            .fetch_one(storage.pool())
            .await?;
    assert_ne!(stored_access_token_hash, raw_access_token);

    let first_replica = ReplicaId::parse(&Uuid::now_v7().to_string())?;
    let second_replica = ReplicaId::parse(&Uuid::now_v7().to_string())?;
    for _ in 0..12 {
        assert_eq!(
            client
                .post(format!(
                    "{production_base}/v1/projects/{}/sync-tickets",
                    production_bootstrap.project_id
                ))
                .bearer_auth("AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                .json(&serde_json::json!({ "replicaId": first_replica }))
                .send()
                .await?
                .status(),
            reqwest::StatusCode::UNAUTHORIZED
        );
    }
    let first_ticket = issue_production_ticket(
        &client,
        &production_base,
        production_bootstrap.project_id,
        first_replica,
        &login.access_token,
    )
    .await?;
    let second_ticket = issue_production_ticket(
        &client,
        &production_base,
        production_bootstrap.project_id,
        second_replica,
        &login.access_token,
    )
    .await?;
    let mut first_socket = open_client(
        production_address,
        production_bootstrap.project_id,
        &first_ticket.ticket,
    )
    .await?;
    let mut second_socket = open_client(
        production_address,
        production_bootstrap.project_id,
        &second_ticket.ticket,
    )
    .await?;
    reconcile_empty(&mut first_socket).await?;
    reconcile_empty(&mut second_socket).await?;
    let production_mutation = MutationEnvelopeV1 {
        client_update_id: ClientUpdateId::parse(&Uuid::now_v7().to_string())?,
        replica_id: first_replica,
        client_sequence: 1,
        edit_session_id: EditSessionId::parse(&Uuid::now_v7().to_string())?,
        origin: MutationOrigin::Human,
        assistance: None,
        update: update.clone(),
    };
    send_client_message(
        &mut first_socket,
        ClientToServerMessageV1::Mutation(production_mutation),
    )
    .await?;
    receive_matching(&mut second_socket, |message| {
        matches!(message, ServerToClientMessageV1::YjsSync(sync) if sync.kind == oleafly_realtime_protocol::ServerYjsSyncKindV1::Broadcast && sync.payload == update)
    })
    .await?;
    production_server.abort();
    Ok(())
}

async fn spawn_server(database_url: String) -> Result<(SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let limits = ServerLimits {
        max_connections: 2,
        ..ServerLimits::default()
    };
    let state = AppState::initialize(ServerConfig {
        bind: address,
        database_url,
        public_url: Url::parse(&format!("http://{address}"))?,
        mode: RuntimeMode::Development,
        master_key: MASTER_KEY,
        setup_token: None,
        dev_bootstrap_token: Some(DEV_TOKEN.to_owned()),
        dev_trust_loopback_proxy: false,
        auto_migrate: false,
        limits,
    })
    .await?;
    let handle = tokio::spawn(async move {
        axum::serve(
            listener,
            router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Ok((address, handle))
}

async fn spawn_production_server(database_url: String) -> Result<(SocketAddr, JoinHandle<()>)> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let address = listener.local_addr()?;
    let state = AppState::initialize(ServerConfig {
        bind: address,
        database_url,
        public_url: Url::parse("https://realtime.example.test")?,
        mode: RuntimeMode::Production,
        master_key: MASTER_KEY,
        setup_token: Some(SETUP_TOKEN.to_owned()),
        dev_bootstrap_token: None,
        dev_trust_loopback_proxy: false,
        auto_migrate: false,
        limits: ServerLimits::default(),
    })
    .await?;
    let handle = tokio::spawn(async move {
        axum::serve(
            listener,
            router(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    Ok((address, handle))
}

async fn issue_production_ticket(
    client: &reqwest::Client,
    base: &str,
    project_id: SharedProjectId,
    replica_id: ReplicaId,
    access_token: &str,
) -> Result<TicketResponse> {
    Ok(client
        .post(format!("{base}/v1/projects/{project_id}/sync-tickets"))
        .bearer_auth(access_token)
        .json(&serde_json::json!({ "replicaId": replica_id }))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?)
}

async fn open_client(
    address: SocketAddr,
    project_id: SharedProjectId,
    encoded_ticket: &str,
) -> Result<TestSocket> {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
    let (mut socket, _) =
        connect_async(format!("ws://{address}/v1/projects/{project_id}/sync")).await?;
    let ticket: [u8; 32] = URL_SAFE_NO_PAD
        .decode(encoded_ticket)?
        .try_into()
        .map_err(|_| anyhow!("bootstrap returned an invalid ticket length"))?;
    let opening = ClientToServerFrameV1 {
        protocol_version: 0,
        message: ClientToServerMessageV1::OpeningAuth(OpeningAuthV1 {
            supported_versions: vec![REALTIME_PROTOCOL_VERSION],
            ticket,
        }),
    };
    socket
        .send(Message::Binary(
            encode_client_to_server_frame_v1(&opening)?.into(),
        ))
        .await?;
    let accepted = next_server_message(&mut socket).await?;
    if !matches!(accepted, ServerToClientMessageV1::OpeningAccepted) {
        bail!("server did not accept realtime opening");
    }
    Ok(socket)
}

async fn reconcile_empty(socket: &mut TestSocket) -> Result<()> {
    let doc = authoring_doc();
    send_client_message(
        socket,
        ClientToServerMessageV1::StateVectorRequest(
            oleafly_realtime_protocol::ClientStateVectorRequestV1 {
                payload: doc.transact().state_vector().encode_v1(),
            },
        ),
    )
    .await?;
    let response = next_server_message(socket).await?;
    if !matches!(response, ServerToClientMessageV1::YjsSync(_)) {
        bail!("server did not answer initial state vector");
    }
    Ok(())
}

async fn send_client_message(
    socket: &mut TestSocket,
    message: ClientToServerMessageV1,
) -> Result<()> {
    socket
        .send(Message::Binary(
            encode_client_to_server_frame_v1(&ClientToServerFrameV1 {
                protocol_version: REALTIME_PROTOCOL_VERSION,
                message,
            })?
            .into(),
        ))
        .await?;
    Ok(())
}

async fn next_server_message(socket: &mut TestSocket) -> Result<ServerToClientMessageV1> {
    let next = timeout(Duration::from_secs(5), socket.next())
        .await
        .context("timed out waiting for server frame")?
        .ok_or_else(|| anyhow!("server closed realtime socket"))??;
    let Message::Binary(bytes) = next else {
        bail!("expected a binary realtime frame");
    };
    Ok(decode_server_to_client_frame_v1(&bytes)?.message)
}

async fn receive_matching(
    socket: &mut TestSocket,
    predicate: impl Fn(&ServerToClientMessageV1) -> bool,
) -> Result<ServerToClientMessageV1> {
    for _ in 0..12 {
        let message = next_server_message(socket).await?;
        if predicate(&message) {
            return Ok(message);
        }
    }
    bail!("did not receive the expected realtime server message")
}
