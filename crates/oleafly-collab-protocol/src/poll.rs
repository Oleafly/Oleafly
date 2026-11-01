use crate::frames::{ClientFrame, FrameErrorCode, ServerFrame};
use serde::de::{self, SeqAccess, Visitor};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::value::RawValue;
use std::fmt;

pub const POLL_KEY_HEADER: &str = "x-oleafly-poll-key";
pub const DEVICE_HEADER: &str = "x-oleafly-device";
pub const NONCE_HEADER: &str = "x-oleafly-nonce";
pub const SIGNATURE_HEADER: &str = "x-oleafly-signature";
pub const PROTOCOL_HEADER: &str = "x-oleafly-protocol";
pub const UNDERSTANDS_HEADER: &str = "x-oleafly-understands";
pub const MAX_POSTED_FRAMES: usize = 64;

pub fn understands_header(codes: &[FrameErrorCode]) -> String {
    codes
        .iter()
        .filter_map(|code| match serde_json::to_value(code) {
            Ok(serde_json::Value::String(name)) => Some(name),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join(",")
}

pub fn understood_codes(header: &str) -> Vec<FrameErrorCode> {
    header
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .filter_map(|name| {
            serde_json::from_value::<FrameErrorCode>(serde_json::Value::String(name.to_owned()))
                .ok()
        })
        .filter(|code| *code != FrameErrorCode::Unknown)
        .collect()
}

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

impl PollFrames {
    pub fn from_json(bytes: &[u8]) -> Result<PollFrames, serde_json::Error> {
        let posted: Posted = serde_json::from_slice(bytes)?;
        Ok(PollFrames {
            frames: posted.frames.0,
        })
    }
}

#[derive(Deserialize)]
struct Posted {
    frames: OneByOne,
}

struct OneByOne(Vec<ClientFrame>);

impl<'de> Deserialize<'de> for OneByOne {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<OneByOne, D::Error> {
        deserializer.deserialize_seq(OneByOne(Vec::new()))
    }
}

impl<'de> Visitor<'de> for OneByOne {
    type Value = OneByOne;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a list of frames")
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut frames: A) -> Result<OneByOne, A::Error> {
        while let Some(raw) = frames.next_element::<&'de RawValue>()? {
            if self.0.len() == MAX_POSTED_FRAMES {
                return Err(de::Error::custom(format!(
                    "Send at most {MAX_POSTED_FRAMES} frames at a time."
                )));
            }
            self.0
                .push(ClientFrame::from_json(raw.get()).map_err(de::Error::custom)?);
        }
        Ok(self)
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PollReplies {
    pub frames: Vec<ServerFrame>,
}

pub const MAX_POLLED_FRAMES: usize = 65_536;

impl PollBatch {
    pub fn from_json(bytes: &[u8]) -> Result<PollBatch, serde_json::Error> {
        let read: Polled = serde_json::from_slice(bytes)?;
        Ok(PollBatch {
            cursor: read.cursor,
            key: read.key,
            frames: read.frames.0,
        })
    }
}

impl PollReplies {
    pub fn from_json(bytes: &[u8]) -> Result<PollReplies, serde_json::Error> {
        let read: Replied = serde_json::from_slice(bytes)?;
        Ok(PollReplies {
            frames: read.frames.0,
        })
    }
}

#[derive(Deserialize)]
struct Polled {
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    key: Option<String>,
    frames: ServerOneByOne,
}

#[derive(Deserialize)]
struct Replied {
    frames: ServerOneByOne,
}

struct ServerOneByOne(Vec<ServerFrame>);

impl<'de> Deserialize<'de> for ServerOneByOne {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<ServerOneByOne, D::Error> {
        deserializer.deserialize_seq(ServerOneByOne(Vec::new()))
    }
}

impl<'de> Visitor<'de> for ServerOneByOne {
    type Value = ServerOneByOne;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("a list of frames")
    }

    fn visit_seq<A: SeqAccess<'de>>(mut self, mut frames: A) -> Result<ServerOneByOne, A::Error> {
        while let Some(raw) = frames.next_element::<&'de RawValue>()? {
            if self.0.len() == MAX_POLLED_FRAMES {
                return Err(de::Error::custom(format!(
                    "a server answer carries at most {MAX_POLLED_FRAMES} frames"
                )));
            }
            self.0
                .push(ServerFrame::from_json(raw.get()).map_err(de::Error::custom)?);
        }
        Ok(self)
    }
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
    fn posted_frames_read_one_by_one_like_the_derived_parse() {
        let text = json!({
            "frames": [
                { "type": "ping", "id": 1 },
                { "type": "from_a_later_client", "detail": [1, 2] },
                { "type": "unsubscribe", "project_id": PROJECT }
            ],
            "later": { "n": 1 }
        })
        .to_string();
        let read = PollFrames::from_json(text.as_bytes()).unwrap();
        assert_eq!(read, serde_json::from_str::<PollFrames>(&text).unwrap());
        assert_eq!(read.frames[1], ClientFrame::Unknown);
        for refused in [
            r#"{"frames":[{"type":"ping"}]}"#,
            r#"{"frames":[1]}"#,
            r#"{"frames":{}}"#,
            r#"{}"#,
        ] {
            assert!(
                PollFrames::from_json(refused.as_bytes()).is_err(),
                "{refused}"
            );
            assert!(
                serde_json::from_str::<PollFrames>(refused).is_err(),
                "{refused}"
            );
        }
    }

    #[test]
    fn a_post_carries_at_most_the_frame_limit() {
        let ping = json!({ "type": "ping", "id": 1 });
        let full = json!({ "frames": vec![ping.clone(); MAX_POSTED_FRAMES] }).to_string();
        assert_eq!(
            PollFrames::from_json(full.as_bytes()).unwrap().frames.len(),
            MAX_POSTED_FRAMES
        );
        let over = json!({ "frames": vec![ping; MAX_POSTED_FRAMES + 1] }).to_string();
        let refused = PollFrames::from_json(over.as_bytes()).unwrap_err();
        assert!(
            refused.to_string().contains("Send at most 64 frames"),
            "{refused}"
        );
    }

    #[test]
    fn batches_and_replies_read_one_frame_at_a_time_like_the_derived_parse() {
        let batch = json!({
            "cursor": "abc.1",
            "key": "secret",
            "frames": [
                { "type": "pong", "id": 1 },
                { "type": "from_a_later_server", "detail": [[1], [2, [3]]] },
                { "type": "snapshot_required", "project_id": PROJECT, "padding": [[0], [0]] },
                { "type": "error", "code": "a_later_code", "message": "m" }
            ],
            "later": { "n": [1, 2, 3] }
        })
        .to_string();
        let read = PollBatch::from_json(batch.as_bytes()).unwrap();
        assert_eq!(read, serde_json::from_str::<PollBatch>(&batch).unwrap());
        assert_eq!(read.cursor.as_deref(), Some("abc.1"));
        assert_eq!(read.frames[1], ServerFrame::Unknown);
        let bare = json!({ "frames": [{ "type": "pong", "id": 2 }] }).to_string();
        assert_eq!(
            PollBatch::from_json(bare.as_bytes()).unwrap(),
            serde_json::from_str::<PollBatch>(&bare).unwrap()
        );
        assert_eq!(
            PollReplies::from_json(bare.as_bytes()).unwrap(),
            serde_json::from_str::<PollReplies>(&bare).unwrap()
        );
        for refused in [
            r#"{"frames":[{"type":"pong"}]}"#,
            r#"{"frames":[1]}"#,
            r#"{"frames":{}}"#,
            r#"{"cursor":"c"}"#,
        ] {
            assert!(
                PollBatch::from_json(refused.as_bytes()).is_err(),
                "{refused}"
            );
            assert!(
                serde_json::from_str::<PollBatch>(refused).is_err(),
                "{refused}"
            );
            assert!(
                PollReplies::from_json(refused.as_bytes()).is_err(),
                "{refused}"
            );
        }
    }

    #[test]
    fn a_server_answer_carries_at_most_the_polled_frame_limit() {
        let frames = |count: usize| {
            let mut text = String::from(r#"{"frames":["#);
            for at in 0..count {
                if at > 0 {
                    text.push(',');
                }
                text.push_str(r#"{"type":"pong","id":1}"#);
            }
            text.push_str("]}");
            text
        };
        let full = frames(MAX_POLLED_FRAMES);
        assert_eq!(
            PollBatch::from_json(full.as_bytes()).unwrap().frames.len(),
            MAX_POLLED_FRAMES
        );
        let over = frames(MAX_POLLED_FRAMES + 1);
        let refused = PollBatch::from_json(over.as_bytes()).unwrap_err();
        assert!(
            refused.to_string().contains("at most 65536 frames"),
            "{refused}"
        );
        assert!(PollReplies::from_json(over.as_bytes()).is_err());
    }

    #[test]
    fn the_error_codes_a_client_understands_travel_in_one_header() {
        use crate::frames::FrameErrorCode;
        let header = understands_header(&[FrameErrorCode::CommentsOff, FrameErrorCode::TooLarge]);
        assert_eq!(header, "comments_off,too_large");
        assert_eq!(
            understood_codes(&header),
            vec![FrameErrorCode::CommentsOff, FrameErrorCode::TooLarge]
        );
        assert_eq!(
            understood_codes(" comments_off , from_the_future,,"),
            vec![FrameErrorCode::CommentsOff]
        );
        assert!(understood_codes("").is_empty());
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
