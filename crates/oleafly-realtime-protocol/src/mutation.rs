use crate::{ClientUpdateId, EditSessionId, ReplicaId};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MutationOrigin {
    Human,
    SuggestionAccept,
    VersionRestore,
    ExternalSmallSave,
    ExternalBulkApply,
    Import,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AiAssistanceReceipt {
    pub provider: String,
    pub model: String,
    pub proposal_identifier: String,
    pub accepted_diff: String,
}

impl AiAssistanceReceipt {
    pub fn validate(&self) -> crate::Result<()> {
        self.validate_with_limit(1_048_576)
    }

    pub fn validate_with_limit(&self, accepted_diff_limit: usize) -> crate::Result<()> {
        if self.provider.is_empty() || self.provider.len() > 128 {
            return Err(crate::ContractError::InvalidMutation(
                "assistance provider must contain 1 to 128 UTF-8 bytes".to_owned(),
            ));
        }
        if self.model.is_empty() || self.model.len() > 256 {
            return Err(crate::ContractError::InvalidMutation(
                "assistance model must contain 1 to 256 UTF-8 bytes".to_owned(),
            ));
        }
        if self.proposal_identifier.is_empty() || self.proposal_identifier.len() > 256 {
            return Err(crate::ContractError::InvalidMutation(
                "assistance proposal identifier must contain 1 to 256 UTF-8 bytes".to_owned(),
            ));
        }
        if self.accepted_diff.len() > accepted_diff_limit {
            return Err(crate::ContractError::InvalidMutation(
                "assistance accepted diff exceeds 1 MiB".to_owned(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MutationEnvelopeV1 {
    pub client_update_id: ClientUpdateId,
    pub replica_id: ReplicaId,
    #[serde(with = "crate::canonical_u64")]
    pub client_sequence: u64,
    pub edit_session_id: EditSessionId,
    pub origin: MutationOrigin,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assistance: Option<AiAssistanceReceipt>,
    pub update: Vec<u8>,
}
