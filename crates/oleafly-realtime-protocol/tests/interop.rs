use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use oleafly_realtime_protocol::{
    apply_update_v1, apply_update_v1_with_limits, authoring_doc_with_client_id,
    canonical_authoring_manifest_v1, decode_client_to_server_frame_v1,
    decode_client_to_server_frame_v1_with_limits, decode_server_to_client_frame_v1,
    encode_client_to_server_frame_v1, encode_client_to_server_frame_v1_with_limits,
    encode_server_to_client_frame_v1, portable_collision_key, snapshot_authoring_doc_v1,
    transition_local_project, transition_server_project, transition_sync_status,
    AuthoringDocSnapshotV1, ClientToServerMessageV1, FileId, LocalProjectEvent, LocalProjectState,
    PendingMutationId, PendingMutationTracker, ProjectCapability, ProjectControlCommandV1,
    ProjectControlsSnapshotV1, ProjectRole, RealtimeLimitsV1, ServerInstanceId, ServerProjectEvent,
    ServerProjectState, ServerToClientMessageV1, SharedProjectBinding, SyncStatus, SyncStatusEvent,
    AUTHORING_CONFLICT_SCHEMA_VERSION, AUTHORING_DOC_SCHEMA_VERSION,
    CANONICAL_MANIFEST_SCHEMA_VERSION, FRAME_HEADER_LENGTH, FRAME_HEADER_VERSION,
    PROJECT_CONTROLS_SCHEMA_VERSION, REALTIME_PROTOCOL_VERSION,
};
use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::Value;
use unicode_normalization::{UnicodeNormalization, UNICODE_VERSION};
use yrs::updates::decoder::Decode;
use yrs::{
    Any, Array, ArrayPrelim, ClientID, Doc, GetString, Map, MapPrelim, OffsetKind, Options, Out,
    ReadTxn, StateVector, StickyIndex, Text, Transact, Update,
};

const MAIN_FILE_ID: &str = "0198cf35-0000-7000-8000-000000000002";
const BINARY_FILE_ID: &str = "0198cf35-0000-7000-8000-000000000005";

const INTEROP_FIXTURE: &str = include_str!("../../../fixtures/realtime/authoring-doc-v1.json");
const CONTRACT_FIXTURE: &str = include_str!("../../../fixtures/realtime/contracts-v1.json");
const CANONICAL_FIXTURE: &str =
    include_str!("../../../fixtures/realtime/canonical-authoring-manifest-v1.json");
const WIRE_FIXTURE: &str = include_str!("../../../fixtures/realtime/wire-v1.json");
const IDENTITY_FIXTURE: &str = include_str!("../../../fixtures/realtime/identity-v1.json");
const CONTROL_JSON_FIXTURE: &str = include_str!("../../../fixtures/realtime/control-json-v1.json");
const MATERIALIZATION_FIXTURE: &str =
    include_str!("../../../fixtures/realtime/materialization-v1.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InteropFixture {
    yjs_update_v1_base64: String,
    yrs_update_v1_base64: String,
}

#[derive(Deserialize)]
struct Transition<S, E> {
    from: S,
    event: E,
    to: S,
}

#[derive(Deserialize)]
struct WireFixture {
    frames: Vec<WireFixtureFrame>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WireFixtureFrame {
    name: String,
    protocol_version: u16,
    base64: String,
}

#[derive(Deserialize)]
struct IdentityFixture {
    accepted: IdentityValues,
    rejected: IdentityValues,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IdentityValues {
    uuid: Vec<String>,
    uuid_v7: Vec<String>,
    u64: Vec<String>,
}

#[derive(Deserialize)]
struct ControlJsonFixture {
    accepted: ControlJsonValues,
    rejected: ControlJsonValues,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlJsonValues {
    project_controls: Vec<Value>,
    bindings: Vec<Value>,
}

#[derive(Deserialize)]
struct MaterializationFixture {
    accepted: Vec<AuthoringDocSnapshotV1>,
    rejected: Vec<RejectedMaterialization>,
}

#[derive(Deserialize)]
struct RejectedMaterialization {
    label: String,
    snapshot: AuthoringDocSnapshotV1,
}

#[test]
fn yrs_reads_yjs_and_yrs_updates_and_matches_the_canonical_manifest() {
    let fixture = interop_fixture();
    let doc = empty_utf16_doc(303);
    apply_update_v1(&doc, &decode(&fixture.yjs_update_v1_base64)).unwrap();
    apply_update_v1(&doc, &decode(&fixture.yrs_update_v1_base64)).unwrap();
    let snapshot = snapshot_authoring_doc_v1(&doc).unwrap();
    assert_eq!(snapshot.nodes.len(), 5);
    assert!(snapshot
        .nodes
        .iter()
        .any(|node| node.file_id().to_string().ends_with("0006") && node.tombstone()));
    assert_eq!(
        canonical_authoring_manifest_v1(&snapshot).unwrap(),
        CANONICAL_FIXTURE.trim()
    );
}

#[test]
fn complete_authoring_state_converges_under_duplicate_replay() {
    let fixture = interop_fixture();
    let yjs_update = decode(&fixture.yjs_update_v1_base64);
    let yrs_update = decode(&fixture.yrs_update_v1_base64);
    let doc = empty_utf16_doc(304);
    for update in [&yjs_update, &yrs_update, &yrs_update, &yjs_update] {
        apply_update_v1(&doc, update).unwrap();
    }
    assert_eq!(
        canonical_authoring_manifest_v1(&snapshot_authoring_doc_v1(&doc).unwrap()).unwrap(),
        CANONICAL_FIXTURE.trim()
    );
}

#[test]
fn recreates_checked_in_yrs_update_byte_for_byte() {
    let fixture = interop_fixture();
    let update = build_yrs_fixture_update(&decode(&fixture.yjs_update_v1_base64));
    assert_eq!(STANDARD.encode(update), fixture.yrs_update_v1_base64);
}

#[test]
fn invalid_update_does_not_mutate_authoritative_doc() {
    let fixture = interop_fixture();
    let authority = empty_utf16_doc(305);
    apply_update_v1(&authority, &decode(&fixture.yjs_update_v1_base64)).unwrap();
    let before = authority
        .transact()
        .encode_state_as_update_v1(&StateVector::default());
    let attacker = empty_utf16_doc(306);
    attacker
        .transact_mut()
        .apply_update(Update::decode_v1(&before).unwrap())
        .unwrap();
    let authority_state = authority.transact().state_vector();
    attacker.get_or_insert_map("authoring").insert(
        &mut attacker.transact_mut(),
        "main_file_id",
        "shadow",
    );
    let invalid = attacker.transact().encode_diff_v1(&authority_state);
    assert!(apply_update_v1(&authority, &invalid).is_err());
    assert_eq!(
        authority
            .transact()
            .encode_state_as_update_v1(&StateVector::default()),
        before
    );
}

#[test]
fn authoring_validation_rejects_unknown_roots_node_keys_and_orphans() {
    let fixture = interop_fixture();
    for configure in [0_u8, 1_u8, 2_u8] {
        let authority = empty_utf16_doc(310 + u64::from(configure));
        apply_update_v1(&authority, &decode(&fixture.yjs_update_v1_base64)).unwrap();
        let before = authority.transact().state_vector();
        let attacker = empty_utf16_doc(320 + u64::from(configure));
        attacker
            .transact_mut()
            .apply_update(
                Update::decode_v1(
                    &authority
                        .transact()
                        .encode_state_as_update_v1(&StateVector::default()),
                )
                .unwrap(),
            )
            .unwrap();
        match configure {
            0 => {
                attacker.get_or_insert_map("unknown").insert(
                    &mut attacker.transact_mut(),
                    "value",
                    true,
                );
            }
            1 => {
                let nodes = attacker.get_or_insert_map("nodes");
                let mut txn = attacker.transact_mut();
                let node = match nodes.get(&txn, "0198cf35-0000-7000-8000-000000000002") {
                    Some(yrs::Out::YMap(node)) => node,
                    _ => panic!("missing node"),
                };
                node.insert(&mut txn, "main_file_id", "shadow");
            }
            _ => {
                attacker.get_or_insert_map("texts").insert(
                    &mut attacker.transact_mut(),
                    "0198cf35-0000-7000-8000-000000000099",
                    Any::Null,
                );
            }
        }
        let update = attacker.transact().encode_diff_v1(&before);
        assert!(apply_update_v1(&authority, &update).is_err());
    }
}

#[test]
fn rust_contracts_match_the_shared_fixture_and_all_illegal_transitions_fail() {
    let fixture: Value = serde_json::from_str(CONTRACT_FIXTURE).unwrap();
    assert_eq!(fixture["versions"]["frameHeader"], FRAME_HEADER_VERSION);
    assert_eq!(fixture["versions"]["protocol"], REALTIME_PROTOCOL_VERSION);
    assert_eq!(
        fixture["versions"]["authoringDoc"],
        AUTHORING_DOC_SCHEMA_VERSION
    );
    assert_eq!(
        fixture["versions"]["authoringConflict"],
        AUTHORING_CONFLICT_SCHEMA_VERSION
    );
    assert_eq!(
        fixture["versions"]["projectControls"],
        PROJECT_CONTROLS_SCHEMA_VERSION
    );
    assert_eq!(
        fixture["versions"]["canonicalManifest"],
        CANONICAL_MANIFEST_SCHEMA_VERSION
    );

    for role in [
        ProjectRole::Viewer,
        ProjectRole::Commenter,
        ProjectRole::Editor,
        ProjectRole::Owner,
    ] {
        let name = serde_json::to_value(role).unwrap();
        let expected: Vec<ProjectCapability> =
            serde_json::from_value(fixture["roleCapabilities"][name.as_str().unwrap()].clone())
                .unwrap();
        assert_eq!(role.capabilities(), expected);
    }
    assert_transition_matrix(
        &fixture["localProjectTransitions"],
        &[
            LocalProjectState::Local,
            LocalProjectState::SharingStaging,
            LocalProjectState::SharingCutover,
            LocalProjectState::JoiningBootstrap,
            LocalProjectState::SharedActive,
            LocalProjectState::RevocationRecovery,
            LocalProjectState::SharedClosed,
        ],
        &[
            LocalProjectEvent::BeginShare,
            LocalProjectEvent::StagingReady,
            LocalProjectEvent::ShareFailed,
            LocalProjectEvent::CutoverCommitted,
            LocalProjectEvent::BeginJoin,
            LocalProjectEvent::BootstrapDurable,
            LocalProjectEvent::JoinFailed,
            LocalProjectEvent::AuthorizationRevoked,
            LocalProjectEvent::LeaveConfirmed,
            LocalProjectEvent::RecoveryDetached,
            LocalProjectEvent::RecoveryExported,
            LocalProjectEvent::RecoveryDiscarded,
        ],
        transition_local_project,
    );
    assert_transition_matrix(
        &fixture["syncStatusTransitions"],
        &[
            SyncStatus::SavedLocally,
            SyncStatus::Syncing,
            SyncStatus::SavedToTeam,
            SyncStatus::Offline,
            SyncStatus::RecoveryRequired,
        ],
        &[
            SyncStatusEvent::LocalMutation,
            SyncStatusEvent::SyncStarted,
            SyncStatusEvent::DurableReceiptPending,
            SyncStatusEvent::DurableReceiptComplete,
            SyncStatusEvent::ReconciliationCompleteNoPending,
            SyncStatusEvent::ConnectionLost,
            SyncStatusEvent::AuthorizationRejected,
        ],
        transition_sync_status,
    );
    assert_transition_matrix(
        &fixture["serverProjectTransitions"],
        &[
            ServerProjectState::Staging,
            ServerProjectState::Active,
            ServerProjectState::ArchivedReadOnly,
            ServerProjectState::DeletePending,
            ServerProjectState::Purged,
        ],
        &[
            ServerProjectEvent::Activate,
            ServerProjectEvent::StagingExpired,
            ServerProjectEvent::Archive,
            ServerProjectEvent::ScheduleDelete,
            ServerProjectEvent::CancelDelete,
            ServerProjectEvent::GraceElapsed,
        ],
        transition_server_project,
    );
}

#[test]
fn directional_binary_frames_round_trip_real_yjs_vectors() {
    let fixture: WireFixture = serde_json::from_str(WIRE_FIXTURE).unwrap();
    for frame in &fixture.frames {
        let bytes = decode(&frame.base64);
        if is_client_frame(&frame.name) {
            let decoded = decode_client_to_server_frame_v1(&bytes).unwrap();
            assert_eq!(decoded.protocol_version, frame.protocol_version);
            assert_eq!(encode_client_to_server_frame_v1(&decoded).unwrap(), bytes);
            validate_real_client_payload(&decoded.message);
        } else {
            let decoded = decode_server_to_client_frame_v1(&bytes).unwrap();
            assert_eq!(decoded.protocol_version, frame.protocol_version);
            assert_eq!(encode_server_to_client_frame_v1(&decoded).unwrap(), bytes);
            validate_real_server_payload(&decoded.message);
        }
    }
}

#[test]
fn client_decoder_rejects_server_messages_and_raw_broadcasts() {
    let fixture: WireFixture = serde_json::from_str(WIRE_FIXTURE).unwrap();
    let receipt = fixture
        .frames
        .iter()
        .find(|frame| frame.name == "durable_receipt")
        .unwrap();
    assert!(decode_client_to_server_frame_v1(&decode(&receipt.base64)).is_err());
    let state = fixture
        .frames
        .iter()
        .find(|frame| frame.name == "yjs_state_vector")
        .unwrap();
    let mut forged = decode(&state.base64);
    forged[FRAME_HEADER_LENGTH] = 2;
    assert!(decode_client_to_server_frame_v1(&forged).is_err());
}

#[test]
fn configured_limits_accept_at_limit_and_reject_over_limit() {
    let fixture: WireFixture = serde_json::from_str(WIRE_FIXTURE).unwrap();
    let frame = fixture
        .frames
        .iter()
        .find(|frame| frame.name == "mutation_without_assistance")
        .unwrap();
    let bytes = decode(&frame.base64);
    let mut decoded = decode_client_to_server_frame_v1(&bytes).unwrap();
    let update_len = match &decoded.message {
        ClientToServerMessageV1::Mutation(envelope) => envelope.update.len(),
        _ => panic!("missing mutation"),
    };
    let limits = RealtimeLimitsV1 {
        max_mutation_update_bytes: update_len,
        ..RealtimeLimitsV1::default()
    };
    assert!(encode_client_to_server_frame_v1_with_limits(&decoded, limits).is_ok());
    let ClientToServerMessageV1::Mutation(envelope) = &mut decoded.message else {
        panic!("missing mutation")
    };
    envelope.update.push(0);
    assert!(encode_client_to_server_frame_v1_with_limits(&decoded, limits).is_err());
    let frame_limits = RealtimeLimitsV1 {
        max_frame_bytes: bytes.len() - 1,
        max_yjs_update_bytes: update_len,
        max_yjs_state_vector_bytes: 1,
        max_mutation_update_bytes: update_len,
        max_relative_position_bytes: 1,
        max_string_bytes: 1,
        max_assistance_accepted_diff_bytes: 1,
    };
    assert!(decode_client_to_server_frame_v1_with_limits(&bytes, frame_limits).is_err());
    let update_limits = RealtimeLimitsV1 {
        max_yjs_update_bytes: 1,
        ..RealtimeLimitsV1::default()
    };
    assert!(apply_update_v1_with_limits(&empty_utf16_doc(500), &[0, 0], update_limits).is_err());
}

#[test]
fn pending_replay_requires_an_identical_mutation_identity() {
    let fixture: WireFixture = serde_json::from_str(WIRE_FIXTURE).unwrap();
    let mutation = decode_client_to_server_frame_v1(&decode(
        &fixture
            .frames
            .iter()
            .find(|frame| frame.name == "mutation_with_assistance")
            .unwrap()
            .base64,
    ))
    .unwrap();
    let receipt = decode_server_to_client_frame_v1(&decode(
        &fixture
            .frames
            .iter()
            .find(|frame| frame.name == "durable_receipt")
            .unwrap()
            .base64,
    ))
    .unwrap();
    let ClientToServerMessageV1::Mutation(mutation) = mutation.message else {
        panic!("missing mutation")
    };
    let ServerToClientMessageV1::DurableReceipt(receipt) = receipt.message else {
        panic!("missing receipt")
    };
    let pending = PendingMutationId {
        client_update_id: mutation.client_update_id,
        replica_id: mutation.replica_id,
        client_sequence: mutation.client_sequence,
    };
    let mut tracker = PendingMutationTracker::default();
    assert!(tracker.add(pending).unwrap());
    assert!(!tracker.add(pending).unwrap());
    assert!(tracker
        .add(PendingMutationId {
            client_update_id: pending.client_update_id,
            replica_id: oleafly_realtime_protocol::ReplicaId::parse(
                "0198cf35-0000-7000-8000-000000000099",
            )
            .unwrap(),
            client_sequence: pending.client_sequence,
        })
        .is_err());
    assert!(tracker.acknowledge(&receipt).unwrap());
    assert!(tracker.is_saved_to_team());
}

#[test]
fn json_u64_controls_and_bindings_match_shared_accept_reject_vectors() {
    let fixture: ControlJsonFixture = serde_json::from_str(CONTROL_JSON_FIXTURE).unwrap();
    for value in fixture.accepted.project_controls {
        if value.get("kind").is_some() {
            assert!(serde_json::from_value::<ProjectControlCommandV1>(value).is_ok());
        } else {
            let parsed = serde_json::from_value::<ProjectControlsSnapshotV1>(value).unwrap();
            assert!(serde_json::to_value(parsed).unwrap()["version"].is_string());
        }
    }
    for value in fixture.rejected.project_controls {
        let accepted = if value.get("kind").is_some() {
            serde_json::from_value::<ProjectControlCommandV1>(value).is_ok()
        } else {
            serde_json::from_value::<ProjectControlsSnapshotV1>(value).is_ok()
        };
        assert!(!accepted);
    }
    for value in fixture.accepted.bindings {
        assert!(serde_json::from_value::<SharedProjectBinding>(value).is_ok());
    }
    for value in fixture.rejected.bindings {
        assert!(serde_json::from_value::<SharedProjectBinding>(value).is_err());
    }
}

#[test]
fn identities_u64_and_unicode_17_match_shared_contracts() {
    let fixture: IdentityFixture = serde_json::from_str(IDENTITY_FIXTURE).unwrap();
    for value in fixture.accepted.uuid {
        assert!(ServerInstanceId::parse(&value).is_ok(), "{value}");
    }
    for value in fixture.rejected.uuid {
        assert!(ServerInstanceId::parse(&value).is_err(), "{value}");
    }
    for value in fixture.accepted.uuid_v7 {
        assert!(FileId::parse(&value).is_ok(), "{value}");
    }
    for value in fixture.rejected.uuid_v7 {
        assert!(FileId::parse(&value).is_err(), "{value}");
    }
    for value in fixture.accepted.u64 {
        assert!(value.parse::<u64>().is_ok(), "{value}");
    }
    for value in fixture.rejected.u64 {
        assert!(value.parse::<u64>().is_err(), "{value}");
    }
    assert_eq!(UNICODE_VERSION, (17, 0, 0));
    assert_eq!("a\u{1add}\u{301}".nfc().collect::<String>(), "á\u{1add}");
    assert_eq!(portable_collision_key("a\u{1add}\u{301}"), "á\u{1add}");
}

#[test]
fn materialization_accept_reject_fixture_matches_rust_validation() {
    let fixture: MaterializationFixture = serde_json::from_str(MATERIALIZATION_FIXTURE).unwrap();
    for snapshot in fixture.accepted {
        oleafly_realtime_protocol::validate_materializable_tree_v1(
            &snapshot.nodes,
            &snapshot.conflicts,
        )
        .unwrap();
    }
    for rejected in fixture.rejected {
        assert!(
            oleafly_realtime_protocol::validate_materializable_tree_v1(
                &rejected.snapshot.nodes,
                &rejected.snapshot.conflicts,
            )
            .is_err(),
            "{}",
            rejected.label
        );
    }
}

#[test]
fn rust_constructor_sets_utf16_options_without_originating_schema() {
    let doc = authoring_doc_with_client_id(900);
    let txn = doc.transact();
    assert!(txn.get_map("authoring").is_none());
    assert!(txn.get_map("nodes").is_none());
}

fn validate_real_client_payload(message: &ClientToServerMessageV1) {
    match message {
        ClientToServerMessageV1::StateVectorRequest(request) => {
            StateVector::decode_v1(&request.payload).unwrap();
        }
        ClientToServerMessageV1::Mutation(envelope) => {
            Update::decode_v1(&envelope.update).unwrap();
        }
        ClientToServerMessageV1::ClientPresence(presence) => {
            if let Some(selection) = &presence.selection {
                StickyIndex::decode_v1(&selection.anchor_relative_position).unwrap();
                StickyIndex::decode_v1(&selection.head_relative_position).unwrap();
            }
        }
        ClientToServerMessageV1::OpeningAuth(_) => {}
    }
}

fn validate_real_server_payload(message: &ServerToClientMessageV1) {
    match message {
        ServerToClientMessageV1::YjsSync(sync) => {
            Update::decode_v1(&sync.payload).unwrap();
        }
        ServerToClientMessageV1::ServerPresence(presence) => {
            if let Some(selection) = &presence.selection {
                StickyIndex::decode_v1(&selection.anchor_relative_position).unwrap();
                StickyIndex::decode_v1(&selection.head_relative_position).unwrap();
            }
        }
        ServerToClientMessageV1::OpeningAccepted | ServerToClientMessageV1::DurableReceipt(_) => {}
    }
}

fn assert_transition_matrix<S, E>(
    fixture: &Value,
    states: &[S],
    events: &[E],
    transition: fn(S, E) -> Option<S>,
) where
    S: Copy + DeserializeOwned + std::fmt::Debug + PartialEq,
    E: Copy + DeserializeOwned + std::fmt::Debug + PartialEq,
{
    let expected: Vec<Transition<S, E>> = serde_json::from_value(fixture.clone()).unwrap();
    for state in states {
        for event in events {
            let target = expected
                .iter()
                .find(|entry| entry.from == *state && entry.event == *event)
                .map(|entry| entry.to);
            assert_eq!(transition(*state, *event), target, "{state:?} + {event:?}");
        }
    }
}

fn interop_fixture() -> InteropFixture {
    serde_json::from_str(INTEROP_FIXTURE).unwrap()
}

fn decode(value: &str) -> Vec<u8> {
    STANDARD.decode(value).unwrap()
}

fn empty_utf16_doc(client_id: u64) -> Doc {
    Doc::with_options(Options {
        offset_kind: OffsetKind::Utf16,
        ..Options::with_client_id(ClientID::new(client_id))
    })
}

fn build_yrs_fixture_update(initial: &[u8]) -> Vec<u8> {
    let doc = empty_utf16_doc(202);
    doc.transact_mut()
        .apply_update(Update::decode_v1(initial).unwrap())
        .unwrap();
    let initial_state = doc.transact().state_vector();
    let metadata = doc.get_or_insert_map("authoring");
    let nodes = doc.get_or_insert_map("nodes");
    let texts = doc.get_or_insert_map("texts");
    let binary_heads = doc.get_or_insert_map("binary_heads");
    let mut txn = doc.transact_mut();
    metadata.insert(&mut txn, "schema_version", 1_i64);
    let main_text = match texts.get(&txn, MAIN_FILE_ID) {
        Some(Out::YText(text)) => text,
        _ => panic!("main file is not a Y.Text"),
    };
    let prefix = "\\documentclass{article}\n\\begin{document}\nHello 🌿";
    assert!(main_text.get_string(&txn).starts_with(prefix));
    main_text.insert(
        &mut txn,
        prefix.encode_utf16().count() as u32,
        " edited by yrs",
    );
    let binary = nodes.insert(&mut txn, BINARY_FILE_ID, MapPrelim::default());
    binary.insert(&mut txn, "parent_id", Any::Null);
    binary.insert(&mut txn, "name", "figure.png");
    binary.insert(&mut txn, "collision_key", "figure.png");
    binary.insert(&mut txn, "tombstone", false);
    binary.insert(&mut txn, "kind", "binary");
    let heads = binary_heads.insert(&mut txn, BINARY_FILE_ID, ArrayPrelim::default());
    heads.push_back(
        &mut txn,
        "sha256:08bb5e5d6eaac1049ede0893d30ed022b1a4d9b5b48e6eae5f6db9f2e2b9f8cc",
    );
    drop(txn);
    let update = doc.transact().encode_diff_v1(&initial_state);
    update
}

fn is_client_frame(name: &str) -> bool {
    matches!(
        name,
        "opening_auth"
            | "yjs_state_vector"
            | "mutation_without_assistance"
            | "mutation_with_assistance"
            | "client_presence"
            | "client_presence_cleared"
    )
}
