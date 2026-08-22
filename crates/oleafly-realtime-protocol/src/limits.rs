use crate::{ContractError, Result};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RealtimeLimitsV1 {
    pub max_frame_bytes: usize,
    pub max_yjs_update_bytes: usize,
    pub max_yjs_state_vector_bytes: usize,
    pub max_mutation_update_bytes: usize,
    pub max_relative_position_bytes: usize,
    pub max_string_bytes: usize,
    pub max_assistance_accepted_diff_bytes: usize,
}

impl Default for RealtimeLimitsV1 {
    fn default() -> Self {
        Self {
            max_frame_bytes: 4 * 1024 * 1024,
            max_yjs_update_bytes: 2 * 1024 * 1024,
            max_yjs_state_vector_bytes: 256 * 1024,
            max_mutation_update_bytes: 2 * 1024 * 1024,
            max_relative_position_bytes: 4 * 1024,
            max_string_bytes: 4 * 1024,
            max_assistance_accepted_diff_bytes: 1024 * 1024,
        }
    }
}

impl RealtimeLimitsV1 {
    pub fn validate(self) -> Result<Self> {
        if self.max_frame_bytes < crate::FRAME_HEADER_LENGTH
            || self.max_frame_bytes > u32::MAX as usize
        {
            return Err(ContractError::InvalidFrame(
                "max_frame_bytes is outside the supported range".to_owned(),
            ));
        }
        for (name, value) in [
            ("max_yjs_update_bytes", self.max_yjs_update_bytes),
            (
                "max_yjs_state_vector_bytes",
                self.max_yjs_state_vector_bytes,
            ),
            ("max_mutation_update_bytes", self.max_mutation_update_bytes),
            (
                "max_relative_position_bytes",
                self.max_relative_position_bytes,
            ),
            ("max_string_bytes", self.max_string_bytes),
            (
                "max_assistance_accepted_diff_bytes",
                self.max_assistance_accepted_diff_bytes,
            ),
        ] {
            if value == 0 || value.saturating_add(32) > self.max_frame_bytes {
                return Err(ContractError::InvalidFrame(format!(
                    "{name} must fit inside max_frame_bytes"
                )));
            }
        }
        if self.max_string_bytes > u16::MAX as usize {
            return Err(ContractError::InvalidFrame(
                "max_string_bytes exceeds the wire string limit".to_owned(),
            ));
        }
        Ok(self)
    }
}
