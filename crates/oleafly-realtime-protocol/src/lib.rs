mod authoring;
mod authorization;
mod canonical;
pub(crate) mod canonical_u64;
mod error;
mod identity;
mod limits;
mod mutation;
mod presence;
mod project_controls;
mod state;
mod version;
mod wire;

pub use authoring::{
    apply_update_v1, apply_update_v1_with_limits, authoring_doc, authoring_doc_with_client_id,
    snapshot_authoring_doc_v1, validate_materializable_tree_v1, AuthoringConflictRecordV1,
    AuthoringDocSnapshotV1, AuthoringNodeSnapshotV1, AUTHORING_CONFLICT_SCHEMA_VERSION,
    AUTHORING_METADATA_KEYS, AUTHORING_ROOTS,
};
pub use authorization::{ProjectCapability, ProjectRole};
pub use canonical::{canonical_authoring_manifest_v1, portable_collision_key};
pub use error::{ContractError, Result};
pub use identity::{
    ActorId, ClientUpdateId, ClosedSharedProjectRecord, ClosedSharedProjectState, ConflictId,
    ContentDigest, EditSessionId, FileId, LocalBindingState, MakeLocalCopyResultV1,
    ProjectRevisionId, RemoteProjectRef, ReplicaId, ServerInstanceId, ServerProfileId,
    SharedProjectBinding, SharedProjectId,
};
pub use limits::RealtimeLimitsV1;
pub use mutation::{AiAssistanceReceipt, MutationEnvelopeV1, MutationOrigin};
pub use presence::{ClientPresenceV1, PresenceSelectionV1, ServerPresenceV1};
pub use project_controls::{
    ProjectControlCommandV1, ProjectControlsSnapshotV1, PROJECT_CONTROLS_SCHEMA_VERSION,
};
pub use state::{
    transition_local_project, transition_server_project, transition_sync_status, LocalProjectEvent,
    LocalProjectState, ServerProjectEvent, ServerProjectState, SyncStatus, SyncStatusEvent,
};
pub use version::{
    negotiate_highest_common_version, negotiate_realtime_protocol_version,
    AUTHORING_DOC_SCHEMA_VERSION, CANONICAL_MANIFEST_SCHEMA_VERSION, REALTIME_PROTOCOL_VERSION,
    SUPPORTED_REALTIME_PROTOCOL_VERSIONS,
};
pub use wire::{
    decode_client_to_server_frame_v1, decode_client_to_server_frame_v1_with_limits,
    decode_server_to_client_frame_v1, decode_server_to_client_frame_v1_with_limits,
    encode_client_to_server_frame_v1, encode_client_to_server_frame_v1_with_limits,
    encode_server_to_client_frame_v1, encode_server_to_client_frame_v1_with_limits,
    ClientStateVectorRequestV1, ClientToServerFrameV1, ClientToServerMessageV1, DurableReceiptV1,
    OpeningAuthV1, PendingMutationId, PendingMutationTracker, ServerToClientFrameV1,
    ServerToClientMessageV1, ServerYjsSyncKindV1, ServerYjsSyncMessageV1, FRAME_HEADER_LENGTH,
    FRAME_HEADER_VERSION, FRAME_MAGIC,
};
