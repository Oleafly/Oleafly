use crate::{ActorId, FileId, ReplicaId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresenceSelectionV1 {
    pub file_id: FileId,
    pub anchor_relative_position: Vec<u8>,
    pub head_relative_position: Vec<u8>,
}

/// Client-to-server presence. Identity is taken from the authenticated session.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(deny_unknown_fields)]
pub struct ClientPresenceV1 {
    pub selection: Option<PresenceSelectionV1>,
}

/// Server-to-client presence with server-stamped identity.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ServerPresenceV1 {
    pub actor_id: ActorId,
    pub replica_id: ReplicaId,
    pub display_name: String,
    pub color_token: String,
    pub selection: Option<PresenceSelectionV1>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_presence_cannot_supply_actor_identity() {
        let forged = r#"{
            "selection": null,
            "actorId": "a07b6610-5950-4b90-8a29-c9ea207236c8"
        }"#;
        assert!(serde_json::from_str::<ClientPresenceV1>(forged).is_err());
    }
}
