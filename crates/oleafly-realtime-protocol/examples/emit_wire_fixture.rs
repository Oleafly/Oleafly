use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use oleafly_realtime_protocol::{
    encode_client_to_server_frame_v1, encode_server_to_client_frame_v1, ActorId,
    AiAssistanceReceipt, ClientPresenceV1, ClientStateVectorRequestV1, ClientToServerFrameV1,
    ClientToServerMessageV1, ClientUpdateId, DurableReceiptV1, EditSessionId, FileId,
    MutationEnvelopeV1, MutationOrigin, OpeningAuthV1, PresenceSelectionV1, ReplicaId,
    ServerPresenceV1, ServerToClientFrameV1, ServerToClientMessageV1, ServerYjsSyncKindV1,
    ServerYjsSyncMessageV1,
};
use serde::Deserialize;
use serde_json::json;
use yrs::updates::decoder::Decode;
use yrs::updates::encoder::Encode;
use yrs::{
    Assoc, ClientID, Doc, IndexedSequence, Map, OffsetKind, Options, Out, ReadTxn, Text, Transact,
    Update,
};

const AUTHORING_FIXTURE: &str = include_str!("../../../fixtures/realtime/authoring-doc-v1.json");
const MAIN_FILE_ID: &str = "0198cf35-0000-7000-8000-000000000002";

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AuthoringFixture {
    yjs_update_v1_base64: String,
}

enum DirectionalFrame {
    Client(ClientToServerFrameV1),
    Server(ServerToClientFrameV1),
}

fn main() {
    let frames = fixture_frames();
    let fixture_frames: Vec<_> = frames
        .iter()
        .map(|(name, frame)| {
            let (protocol_version, bytes) = match frame {
                DirectionalFrame::Client(frame) => (
                    frame.protocol_version,
                    encode_client_to_server_frame_v1(frame).unwrap(),
                ),
                DirectionalFrame::Server(frame) => (
                    frame.protocol_version,
                    encode_server_to_client_frame_v1(frame).unwrap(),
                ),
            };
            json!({
                "name": name,
                "protocolVersion": protocol_version,
                "base64": STANDARD.encode(bytes),
            })
        })
        .collect();
    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "fixtureVersion": 1,
            "frameHeaderVersion": 1,
            "encoding": "oleafly-realtime-binary-v1-base64",
            "frames": fixture_frames,
        }))
        .unwrap()
    );
}

fn fixture_frames() -> Vec<(&'static str, DirectionalFrame)> {
    let authoring: AuthoringFixture = serde_json::from_str(AUTHORING_FIXTURE).unwrap();
    let initial = STANDARD.decode(authoring.yjs_update_v1_base64).unwrap();
    let source = Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::with_client_id(ClientID::new(404))
    });
    source
        .transact_mut()
        .apply_update(Update::decode_v1(&initial).unwrap())
        .unwrap();
    let initial_state_vector = source.transact().state_vector().encode_v1();
    let sync_update = initial;
    let texts = source.get_or_insert_map("texts");
    let mut txn = source.transact_mut();
    let main_text = match texts.get(&txn, MAIN_FILE_ID) {
        Some(Out::YText(text)) => text,
        _ => panic!("wire fixture main text is missing"),
    };
    let anchor_relative_position = main_text
        .sticky_index(&txn, 8, Assoc::After)
        .unwrap()
        .encode_v1();
    let head_relative_position = main_text
        .sticky_index(&txn, 24, Assoc::After)
        .unwrap()
        .encode_v1();
    let mutation_base = txn.state_vector();
    main_text.insert(&mut txn, 8, "live ");
    drop(txn);
    let mutation_update = source.transact().encode_diff_v1(&mutation_base);

    let client_update_id = ClientUpdateId::parse("0198cf35-0000-7000-8000-000000000010").unwrap();
    let replica_id = ReplicaId::parse("0198cf35-0000-7000-8000-000000000011").unwrap();
    let edit_session_id = EditSessionId::parse("0198cf35-0000-7000-8000-000000000012").unwrap();
    let file_id = FileId::parse(MAIN_FILE_ID).unwrap();
    let selection = PresenceSelectionV1 {
        file_id,
        anchor_relative_position,
        head_relative_position,
    };
    let server_presence = |selection| ServerPresenceV1 {
        actor_id: ActorId::parse("a07b6610-5950-4b90-8a29-c9ea207236c8").unwrap(),
        replica_id,
        display_name: "Alice 🌿".to_owned(),
        color_token: "fern".to_owned(),
        selection,
    };
    vec![
        (
            "opening_auth",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 0,
                message: ClientToServerMessageV1::OpeningAuth(OpeningAuthV1 {
                    supported_versions: vec![3, 1, 2],
                    ticket: std::array::from_fn(|index| index as u8),
                }),
            }),
        ),
        (
            "opening_accepted",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::OpeningAccepted,
            }),
        ),
        (
            "yjs_state_vector",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 1,
                message: ClientToServerMessageV1::StateVectorRequest(ClientStateVectorRequestV1 {
                    payload: initial_state_vector,
                }),
            }),
        ),
        (
            "yjs_sync_update",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::YjsSync(ServerYjsSyncMessageV1 {
                    kind: ServerYjsSyncKindV1::SyncUpdate,
                    payload: sync_update,
                }),
            }),
        ),
        (
            "yjs_broadcast",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::YjsSync(ServerYjsSyncMessageV1 {
                    kind: ServerYjsSyncKindV1::Broadcast,
                    payload: mutation_update.clone(),
                }),
            }),
        ),
        (
            "mutation_without_assistance",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 1,
                message: ClientToServerMessageV1::Mutation(MutationEnvelopeV1 {
                    client_update_id: ClientUpdateId::parse("0198cf35-0000-7000-8000-000000000013")
                        .unwrap(),
                    replica_id,
                    client_sequence: 1,
                    edit_session_id,
                    origin: MutationOrigin::Human,
                    assistance: None,
                    update: mutation_update.clone(),
                }),
            }),
        ),
        (
            "mutation_with_assistance",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 1,
                message: ClientToServerMessageV1::Mutation(MutationEnvelopeV1 {
                    client_update_id,
                    replica_id,
                    client_sequence: u64::MAX,
                    edit_session_id,
                    origin: MutationOrigin::Human,
                    assistance: Some(AiAssistanceReceipt {
                        provider: "openai".to_owned(),
                        model: "gpt-test".to_owned(),
                        proposal_identifier: "proposal-fern".to_owned(),
                        accepted_diff: "+Hello 🌿\n".to_owned(),
                    }),
                    update: mutation_update,
                }),
            }),
        ),
        (
            "durable_receipt",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::DurableReceipt(DurableReceiptV1 {
                    client_update_id,
                    replica_id,
                    client_sequence: u64::MAX,
                    server_sequence: 9_007_199_254_740_993,
                    authorization_epoch: 42,
                    committed_at_unix_ms: 1_770_000_000_123,
                }),
            }),
        ),
        (
            "client_presence",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 1,
                message: ClientToServerMessageV1::ClientPresence(ClientPresenceV1 {
                    selection: Some(selection.clone()),
                }),
            }),
        ),
        (
            "client_presence_cleared",
            DirectionalFrame::Client(ClientToServerFrameV1 {
                protocol_version: 1,
                message: ClientToServerMessageV1::ClientPresence(ClientPresenceV1 {
                    selection: None,
                }),
            }),
        ),
        (
            "server_presence",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::ServerPresence(server_presence(Some(selection))),
            }),
        ),
        (
            "server_presence_cleared",
            DirectionalFrame::Server(ServerToClientFrameV1 {
                protocol_version: 1,
                message: ServerToClientMessageV1::ServerPresence(server_presence(None)),
            }),
        ),
    ]
}
