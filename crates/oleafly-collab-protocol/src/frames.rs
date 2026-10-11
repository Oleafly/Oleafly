use crate::ids::{AccountId, DeviceId, ServerId};
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientFrame {
    Hello {
        protocol: u32,
        device_id: DeviceId,
        access_token: String,
        nonce: String,
        signature: String,
    },
    Ping {
        id: u64,
    },
}

impl fmt::Debug for ClientFrame {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ClientFrame::Hello {
                protocol,
                device_id,
                access_token: _,
                nonce,
                signature,
            } => formatter
                .debug_struct("Hello")
                .field("protocol", protocol)
                .field("device_id", device_id)
                .field("access_token", &"[redacted]")
                .field("nonce", nonce)
                .field("signature", signature)
                .finish(),
            ClientFrame::Ping { id } => formatter.debug_struct("Ping").field("id", id).finish(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerFrame {
    Challenge {
        nonce: String,
        server_id: ServerId,
    },
    Welcome {
        protocol: u32,
        account_id: AccountId,
    },
    Pong {
        id: u64,
    },
    Error {
        code: FrameErrorCode,
        message: String,
    },
    SessionRevoked,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameErrorCode {
    Unauthorized,
    ProtocolMismatch,
    RateLimited,
    BadFrame,
    Internal,
    #[serde(other)]
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const SERVER: &str = "01920000-0000-7000-8000-000000000001";
    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";
    const DEVICE: &str = "01920000-0000-7000-8000-000000000003";

    fn assert_client_wire(frame: ClientFrame, wire: Value) {
        assert_eq!(serde_json::to_value(&frame).unwrap(), wire);
        assert_eq!(serde_json::from_value::<ClientFrame>(wire).unwrap(), frame);
    }

    fn assert_server_wire(frame: ServerFrame, wire: Value) {
        assert_eq!(serde_json::to_value(&frame).unwrap(), wire);
        assert_eq!(serde_json::from_value::<ServerFrame>(wire).unwrap(), frame);
    }

    #[test]
    fn client_frames_match_their_wire_json() {
        assert_client_wire(
            ClientFrame::Hello {
                protocol: 1,
                device_id: DEVICE.parse().unwrap(),
                access_token: "at".to_string(),
                nonce: "n".to_string(),
                signature: "sig".to_string(),
            },
            json!({
                "type": "hello",
                "protocol": 1,
                "device_id": DEVICE,
                "access_token": "at",
                "nonce": "n",
                "signature": "sig"
            }),
        );
        assert_client_wire(
            ClientFrame::Ping { id: 42 },
            json!({ "type": "ping", "id": 42 }),
        );
    }

    #[test]
    fn server_frames_match_their_wire_json() {
        assert_server_wire(
            ServerFrame::Challenge {
                nonce: "n".to_string(),
                server_id: SERVER.parse().unwrap(),
            },
            json!({ "type": "challenge", "nonce": "n", "server_id": SERVER }),
        );
        assert_server_wire(
            ServerFrame::Welcome {
                protocol: 1,
                account_id: ACCOUNT.parse().unwrap(),
            },
            json!({ "type": "welcome", "protocol": 1, "account_id": ACCOUNT }),
        );
        assert_server_wire(
            ServerFrame::Pong { id: 42 },
            json!({ "type": "pong", "id": 42 }),
        );
        assert_server_wire(
            ServerFrame::Error {
                code: FrameErrorCode::ProtocolMismatch,
                message: "update".to_string(),
            },
            json!({ "type": "error", "code": "protocol_mismatch", "message": "update" }),
        );
        assert_server_wire(
            ServerFrame::SessionRevoked,
            json!({ "type": "session_revoked" }),
        );
    }

    #[test]
    fn frame_error_codes_use_snake_case_and_read_new_codes_as_unknown() {
        let codes = [
            (FrameErrorCode::Unauthorized, "unauthorized"),
            (FrameErrorCode::ProtocolMismatch, "protocol_mismatch"),
            (FrameErrorCode::RateLimited, "rate_limited"),
            (FrameErrorCode::BadFrame, "bad_frame"),
            (FrameErrorCode::Internal, "internal"),
            (FrameErrorCode::Unknown, "unknown"),
        ];
        for (code, name) in codes {
            assert_eq!(serde_json::to_value(code).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<FrameErrorCode>(json!(name)).unwrap(),
                code
            );
        }
        assert_eq!(
            serde_json::from_value::<FrameErrorCode>(json!("quota_exceeded")).unwrap(),
            FrameErrorCode::Unknown
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "error",
                "code": "quota_exceeded",
                "message": "m"
            }))
            .unwrap(),
            ServerFrame::Error {
                code: FrameErrorCode::Unknown,
                message: "m".to_string(),
            }
        );
    }

    #[test]
    fn malformed_frames_are_rejected() {
        for wire in [
            json!({ "type": "bogus" }),
            json!({ "id": 1 }),
            json!({ "type": "Ping", "id": 1 }),
            json!({ "type": "ping", "id": -1 }),
            json!({
                "type": "hello",
                "protocol": 1,
                "device_id": "01920000-0000-7000-8000-00000000000A",
                "access_token": "at",
                "nonce": "n",
                "signature": "s"
            }),
        ] {
            assert!(
                serde_json::from_value::<ClientFrame>(wire.clone()).is_err(),
                "{wire}"
            );
        }
        assert!(serde_json::from_value::<ServerFrame>(json!({
            "type": "challenge",
            "nonce": "n",
            "server_id": "a07b6610-5950-4b90-8a29-c9ea207236c8"
        }))
        .is_err());
    }

    #[test]
    fn debug_output_never_shows_the_access_token() {
        let hello = ClientFrame::Hello {
            protocol: 1,
            device_id: DEVICE.parse().unwrap(),
            access_token: "secret-access".to_string(),
            nonce: "n".to_string(),
            signature: "s".to_string(),
        };
        let printed = format!("{hello:?}");
        assert!(!printed.contains("secret-access"), "{printed}");
        assert!(printed.contains(DEVICE));
        assert_eq!(
            format!("{:?}", ClientFrame::Ping { id: 3 }),
            "Ping { id: 3 }"
        );
    }
}
