use crate::frames::{ClientFrame, ServerFrame};
use serde::{Deserialize, Serialize};
use std::fmt;

pub const POLL_KEY_HEADER: &str = "x-oleafly-poll-key";
pub const DEVICE_HEADER: &str = "x-oleafly-device";
pub const NONCE_HEADER: &str = "x-oleafly-nonce";
pub const SIGNATURE_HEADER: &str = "x-oleafly-signature";
pub const PROTOCOL_HEADER: &str = "x-oleafly-protocol";
pub const MAX_POSTED_FRAMES: usize = 64;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollBatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key: Option<String>,
    pub frames: Vec<ServerFrame>,
}

impl fmt::Debug for PollBatch {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("PollBatch")
            .field("cursor", &self.cursor)
            .field("key", &self.key.as_ref().map(|_| "[redacted]"))
            .field("frames", &self.frames)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollFrames {
    pub frames: Vec<ClientFrame>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollReplies {
    pub frames: Vec<ServerFrame>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";

    #[test]
    fn an_opened_batch_carries_its_cursor_key_and_frames() {
        let batch = PollBatch {
            cursor: Some("abc.0".to_owned()),
            key: Some("secret".to_owned()),
            frames: vec![ServerFrame::Pong { id: 3 }],
        };
        let wire = json!({
            "cursor": "abc.0",
            "key": "secret",
            "frames": [{ "type": "pong", "id": 3 }]
        });
        assert_eq!(serde_json::to_value(&batch).unwrap(), wire);
        assert_eq!(serde_json::from_value::<PollBatch>(wire).unwrap(), batch);
    }

    #[test]
    fn a_refused_open_has_frames_only() {
        let wire = json!({
            "frames": [{ "type": "snapshot_required", "project_id": PROJECT }]
        });
        let batch: PollBatch = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(batch.cursor, None);
        assert_eq!(batch.key, None);
        assert_eq!(serde_json::to_value(&batch).unwrap(), wire);
    }

    #[test]
    fn posted_frames_and_replies_are_lists_of_frames() {
        let posted = PollFrames {
            frames: vec![ClientFrame::Ping { id: 1 }],
        };
        assert_eq!(
            serde_json::to_value(&posted).unwrap(),
            json!({ "frames": [{ "type": "ping", "id": 1 }] })
        );
        let replies: PollReplies =
            serde_json::from_value(json!({ "frames": [{ "type": "pong", "id": 1 }] })).unwrap();
        assert_eq!(replies.frames, vec![ServerFrame::Pong { id: 1 }]);
    }

    #[test]
    fn debug_output_never_shows_the_poll_key() {
        let batch = PollBatch {
            cursor: Some("abc.0".to_owned()),
            key: Some("very-secret-key".to_owned()),
            frames: Vec::new(),
        };
        let printed = format!("{batch:?}");
        assert!(!printed.contains("very-secret-key"), "{printed}");
        assert!(printed.contains("abc.0"), "{printed}");
    }
}
