use crate::auth::SessionEndReason;
use crate::envelope::Envelope;
use crate::ids::{AccountId, DeviceId, ServerId, SharedProjectId};
use crate::projects::PresenceState;
use crate::roles::ProjectRole;
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
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        understands: Vec<FrameErrorCode>,
    },
    Ping {
        id: u64,
    },
    Subscribe {
        project_id: SharedProjectId,
        since_seq: u64,
    },
    Unsubscribe {
        project_id: SharedProjectId,
    },
    Update {
        project_id: SharedProjectId,
        envelope: Envelope,
    },
    Presence {
        project_id: SharedProjectId,
        state: PresenceState,
    },
    PresenceLeave {
        project_id: SharedProjectId,
    },
    #[serde(other)]
    Unknown,
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
                understands,
            } => formatter
                .debug_struct("Hello")
                .field("protocol", protocol)
                .field("device_id", device_id)
                .field("access_token", &"[redacted]")
                .field("nonce", nonce)
                .field("signature", signature)
                .field("understands", understands)
                .finish(),
            ClientFrame::Ping { id } => formatter.debug_struct("Ping").field("id", id).finish(),
            ClientFrame::Subscribe {
                project_id,
                since_seq,
            } => formatter
                .debug_struct("Subscribe")
                .field("project_id", project_id)
                .field("since_seq", since_seq)
                .finish(),
            ClientFrame::Unsubscribe { project_id } => formatter
                .debug_struct("Unsubscribe")
                .field("project_id", project_id)
                .finish(),
            ClientFrame::Update {
                project_id,
                envelope,
            } => formatter
                .debug_struct("Update")
                .field("project_id", project_id)
                .field("batch_id", &envelope.batch_id)
                .field("payload", &format!("{} bytes", envelope.payload.len()))
                .finish(),
            ClientFrame::Presence { project_id, state } => formatter
                .debug_struct("Presence")
                .field("project_id", project_id)
                .field("state", state)
                .finish(),
            ClientFrame::PresenceLeave { project_id } => formatter
                .debug_struct("PresenceLeave")
                .field("project_id", project_id)
                .finish(),
            ClientFrame::Unknown => formatter.write_str("Unknown"),
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
    SessionRevoked {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reason: Option<SessionEndReason>,
    },
    Subscribed {
        project_id: SharedProjectId,
        role: ProjectRole,
        head_seq: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        since_batch: Option<crate::ids::BatchId>,
    },
    Update {
        project_id: SharedProjectId,
        seq: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        account_id: Option<AccountId>,
        envelope: Envelope,
    },
    Ack {
        project_id: SharedProjectId,
        batch_id: crate::ids::BatchId,
        seq: u64,
    },
    SnapshotRequired {
        project_id: SharedProjectId,
    },
    Presence {
        project_id: SharedProjectId,
        device_id: DeviceId,
        account_id: AccountId,
        state: PresenceState,
    },
    PresenceLeft {
        project_id: SharedProjectId,
        device_id: DeviceId,
    },
    AccessChanged {
        project_id: SharedProjectId,
        role: Option<ProjectRole>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        change: Option<MemberChange>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        comments: Option<CommentSwitches>,
    },
    ProjectArchived {
        project_id: SharedProjectId,
    },
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentSwitches {
    pub server: bool,
    pub project: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberChange {
    pub account_id: AccountId,
    pub by: AccountId,
    pub kind: MemberChangeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberChangeKind {
    Added,
    Removed,
    RoleChanged,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FrameErrorCode {
    Unauthorized,
    ProtocolMismatch,
    RateLimited,
    BadFrame,
    Internal,
    Forbidden,
    NotFound,
    TooLarge,
    CommentsOff,
    #[serde(other)]
    Unknown,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::SessionEndReason;
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
                understands: Vec::new(),
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
            ServerFrame::SessionRevoked { reason: None },
            json!({ "type": "session_revoked" }),
        );
    }

    #[derive(Debug, PartialEq, serde::Deserialize)]
    #[serde(tag = "type", rename_all = "snake_case")]
    enum EarlierServerFrame {
        SessionRevoked,
        AccessChanged {
            project_id: SharedProjectId,
            role: Option<ProjectRole>,
        },
    }

    #[test]
    fn a_revoked_session_can_say_why_and_earlier_clients_still_read_it() {
        let suspended = ServerFrame::SessionRevoked {
            reason: Some(SessionEndReason::AccountSuspended),
        };
        let wire = json!({ "type": "session_revoked", "reason": "account_suspended" });
        assert_server_wire(suspended, wire.clone());
        assert_eq!(
            serde_json::from_value::<EarlierServerFrame>(wire).unwrap(),
            EarlierServerFrame::SessionRevoked
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({ "type": "session_revoked" })).unwrap(),
            ServerFrame::SessionRevoked { reason: None }
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(
                json!({ "type": "session_revoked", "reason": "account_deleted" })
            )
            .unwrap(),
            ServerFrame::SessionRevoked {
                reason: Some(SessionEndReason::Unknown)
            }
        );
    }

    #[test]
    fn a_frame_of_a_type_this_build_does_not_know_reads_as_unknown_and_its_details_are_ignored() {
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "from_a_later_server",
                "project_id": PROJECT,
                "detail": { "kind": "unknown", "n": 1 }
            }))
            .unwrap(),
            ServerFrame::Unknown
        );
        assert_eq!(
            serde_json::from_value::<ClientFrame>(json!({
                "type": "from_a_later_client",
                "detail": [1, 2]
            }))
            .unwrap(),
            ClientFrame::Unknown
        );
        assert!(serde_json::from_value::<ServerFrame>(json!({ "type": "pong" })).is_err());
        assert!(serde_json::from_value::<ClientFrame>(json!({ "type": "ping" })).is_err());
        let batch: Vec<ServerFrame> = serde_json::from_value(json!([
            { "type": "pong", "id": 1 },
            { "type": "from_a_later_server", "detail": null },
            { "type": "pong", "id": 2 }
        ]))
        .unwrap();
        assert_eq!(
            batch,
            vec![
                ServerFrame::Pong { id: 1 },
                ServerFrame::Unknown,
                ServerFrame::Pong { id: 2 }
            ]
        );
    }

    #[test]
    fn an_access_change_can_carry_the_comment_switches_and_earlier_clients_ignore_them() {
        let frame = ServerFrame::AccessChanged {
            project_id: PROJECT.parse().unwrap(),
            role: Some(ProjectRole::Editor),
            change: None,
            comments: Some(CommentSwitches {
                server: true,
                project: false,
            }),
        };
        let wire = json!({
            "type": "access_changed",
            "project_id": PROJECT,
            "role": "editor",
            "comments": { "server": true, "project": false }
        });
        assert_server_wire(frame, wire.clone());
        assert_eq!(
            serde_json::from_value::<EarlierServerFrame>(wire).unwrap(),
            EarlierServerFrame::AccessChanged {
                project_id: PROJECT.parse().unwrap(),
                role: Some(ProjectRole::Editor),
            }
        );
    }

    #[test]
    fn an_access_change_can_name_who_changed_whom_and_earlier_clients_ignore_it() {
        let change = MemberChange {
            account_id: DEVICE_OWNER.parse().unwrap(),
            by: ACCOUNT.parse().unwrap(),
            kind: MemberChangeKind::Removed,
        };
        let frame = ServerFrame::AccessChanged {
            project_id: PROJECT.parse().unwrap(),
            role: Some(ProjectRole::Editor),
            change: Some(change),
            comments: None,
        };
        let wire = json!({
            "type": "access_changed",
            "project_id": PROJECT,
            "role": "editor",
            "change": { "account_id": DEVICE_OWNER, "by": ACCOUNT, "kind": "removed" }
        });
        assert_server_wire(frame, wire.clone());
        assert_eq!(
            serde_json::from_value::<EarlierServerFrame>(wire).unwrap(),
            EarlierServerFrame::AccessChanged {
                project_id: PROJECT.parse().unwrap(),
                role: Some(ProjectRole::Editor),
            }
        );
        for (kind, name) in [
            (MemberChangeKind::Added, "added"),
            (MemberChangeKind::Removed, "removed"),
            (MemberChangeKind::RoleChanged, "role_changed"),
        ] {
            assert_eq!(serde_json::to_value(kind).unwrap(), name);
        }
        assert_eq!(
            serde_json::from_value::<MemberChangeKind>(json!("transferred")).unwrap(),
            MemberChangeKind::Unknown
        );
    }

    const DEVICE_OWNER: &str = "01920000-0000-7000-8000-000000000004";

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
            json!({ "type": "Ping", "id": 1 }),
        ] {
            assert_eq!(
                serde_json::from_value::<ClientFrame>(wire.clone()).unwrap(),
                ClientFrame::Unknown,
                "{wire}"
            );
        }
        for wire in [
            json!({ "id": 1 }),
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
            understands: Vec::new(),
        };
        let printed = format!("{hello:?}");
        assert!(!printed.contains("secret-access"), "{printed}");
        assert!(printed.contains(DEVICE));
        assert_eq!(
            format!("{:?}", ClientFrame::Ping { id: 3 }),
            "Ping { id: 3 }"
        );
    }

    fn envelope() -> crate::envelope::Envelope {
        crate::envelope::Envelope {
            v: 1,
            project_id: PROJECT.parse().unwrap(),
            batch_id: BATCH.parse().unwrap(),
            device_id: DEVICE.parse().unwrap(),
            mode: crate::envelope::EnvelopeMode::Plain,
            key_epoch: None,
            payload: vec![1, 2, 3],
            signature: vec![4, 5],
        }
    }

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";
    const BATCH: &str = "01920000-0000-7000-8000-0000000000bb";

    #[test]
    fn room_frames_match_their_wire_json() {
        let envelope_json = serde_json::to_value(envelope()).unwrap();
        assert_client_wire(
            ClientFrame::Subscribe {
                project_id: PROJECT.parse().unwrap(),
                since_seq: 7,
            },
            json!({ "type": "subscribe", "project_id": PROJECT, "since_seq": 7 }),
        );
        assert_client_wire(
            ClientFrame::Unsubscribe {
                project_id: PROJECT.parse().unwrap(),
            },
            json!({ "type": "unsubscribe", "project_id": PROJECT }),
        );
        assert_client_wire(
            ClientFrame::Update {
                project_id: PROJECT.parse().unwrap(),
                envelope: envelope(),
            },
            json!({ "type": "update", "project_id": PROJECT, "envelope": envelope_json.clone() }),
        );
        assert_client_wire(
            ClientFrame::Presence {
                project_id: PROJECT.parse().unwrap(),
                state: crate::projects::PresenceState {
                    file_id: Some("f1".to_string()),
                    cursor: Some(2),
                    anchor: None,
                },
            },
            json!({
                "type": "presence",
                "project_id": PROJECT,
                "state": { "file_id": "f1", "cursor": 2, "anchor": null }
            }),
        );
        assert_client_wire(
            ClientFrame::PresenceLeave {
                project_id: PROJECT.parse().unwrap(),
            },
            json!({ "type": "presence_leave", "project_id": PROJECT }),
        );
        assert_server_wire(
            ServerFrame::Subscribed {
                project_id: PROJECT.parse().unwrap(),
                role: crate::roles::ProjectRole::Editor,
                head_seq: 9,
                since_batch: None,
            },
            json!({ "type": "subscribed", "project_id": PROJECT, "role": "editor", "head_seq": 9 }),
        );
        assert_server_wire(
            ServerFrame::Update {
                project_id: PROJECT.parse().unwrap(),
                seq: 10,
                account_id: Some(ACCOUNT.parse().unwrap()),
                envelope: envelope(),
            },
            json!({
                "type": "update",
                "project_id": PROJECT,
                "seq": 10,
                "account_id": ACCOUNT,
                "envelope": envelope_json.clone()
            }),
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "update",
                "project_id": PROJECT,
                "seq": 10,
                "envelope": envelope_json
            }))
            .unwrap(),
            ServerFrame::Update {
                project_id: PROJECT.parse().unwrap(),
                seq: 10,
                account_id: None,
                envelope: envelope(),
            }
        );
        assert_server_wire(
            ServerFrame::Ack {
                project_id: PROJECT.parse().unwrap(),
                batch_id: BATCH.parse().unwrap(),
                seq: 10,
            },
            json!({ "type": "ack", "project_id": PROJECT, "batch_id": BATCH, "seq": 10 }),
        );
        assert_server_wire(
            ServerFrame::SnapshotRequired {
                project_id: PROJECT.parse().unwrap(),
            },
            json!({ "type": "snapshot_required", "project_id": PROJECT }),
        );
        assert_server_wire(
            ServerFrame::Presence {
                project_id: PROJECT.parse().unwrap(),
                device_id: DEVICE.parse().unwrap(),
                account_id: ACCOUNT.parse().unwrap(),
                state: crate::projects::PresenceState::default(),
            },
            json!({
                "type": "presence",
                "project_id": PROJECT,
                "device_id": DEVICE,
                "account_id": ACCOUNT,
                "state": { "file_id": null, "cursor": null, "anchor": null }
            }),
        );
        assert_server_wire(
            ServerFrame::PresenceLeft {
                project_id: PROJECT.parse().unwrap(),
                device_id: DEVICE.parse().unwrap(),
            },
            json!({ "type": "presence_left", "project_id": PROJECT, "device_id": DEVICE }),
        );
        assert_server_wire(
            ServerFrame::AccessChanged {
                project_id: PROJECT.parse().unwrap(),
                role: None,
                change: None,
                comments: None,
            },
            json!({ "type": "access_changed", "project_id": PROJECT, "role": null }),
        );
        assert_server_wire(
            ServerFrame::ProjectArchived {
                project_id: PROJECT.parse().unwrap(),
            },
            json!({ "type": "project_archived", "project_id": PROJECT }),
        );
    }

    #[test]
    fn subscribed_names_the_change_stored_at_the_clients_since_number() {
        let named = ServerFrame::Subscribed {
            project_id: PROJECT.parse().unwrap(),
            role: crate::roles::ProjectRole::Editor,
            head_seq: 9,
            since_batch: Some(BATCH.parse().unwrap()),
        };
        assert_server_wire(
            named,
            json!({
                "type": "subscribed",
                "project_id": PROJECT,
                "role": "editor",
                "head_seq": 9,
                "since_batch": BATCH
            }),
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "subscribed",
                "project_id": PROJECT,
                "role": "editor",
                "head_seq": 9
            }))
            .unwrap(),
            ServerFrame::Subscribed {
                project_id: PROJECT.parse().unwrap(),
                role: crate::roles::ProjectRole::Editor,
                head_seq: 9,
                since_batch: None,
            }
        );
    }

    #[test]
    fn frames_with_a_role_or_mode_from_a_later_server_stay_readable() {
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "subscribed",
                "project_id": PROJECT,
                "role": "commenter",
                "head_seq": 9
            }))
            .unwrap(),
            ServerFrame::Subscribed {
                project_id: PROJECT.parse().unwrap(),
                role: ProjectRole::Unknown,
                head_seq: 9,
                since_batch: None,
            }
        );
        assert_eq!(
            serde_json::from_value::<ServerFrame>(json!({
                "type": "access_changed",
                "project_id": PROJECT,
                "role": "commenter"
            }))
            .unwrap(),
            ServerFrame::AccessChanged {
                project_id: PROJECT.parse().unwrap(),
                role: Some(ProjectRole::Unknown),
                change: None,
                comments: None,
            }
        );
        let mut sealed = serde_json::to_value(envelope()).unwrap();
        sealed["mode"] = json!("sealed");
        let read = serde_json::from_value::<ServerFrame>(json!({
            "type": "update",
            "project_id": PROJECT,
            "seq": 10,
            "envelope": sealed
        }))
        .unwrap();
        assert!(
            matches!(
                &read,
                ServerFrame::Update { envelope, .. }
                    if envelope.mode == crate::envelope::EnvelopeMode::Unknown
            ),
            "{read:?}"
        );
    }

    #[test]
    fn an_update_frame_does_not_print_its_payload() {
        let frame = ClientFrame::Update {
            project_id: PROJECT.parse().unwrap(),
            envelope: envelope(),
        };
        let printed = format!("{frame:?}");
        assert!(printed.contains("Update"));
        assert!(printed.contains("3 bytes"));
    }

    #[test]
    fn newer_frame_errors_still_parse() {
        for (code, wire) in [
            (FrameErrorCode::Forbidden, "forbidden"),
            (FrameErrorCode::NotFound, "not_found"),
            (FrameErrorCode::TooLarge, "too_large"),
        ] {
            assert_eq!(serde_json::to_value(code).unwrap(), json!(wire));
        }
    }

    #[derive(Debug, PartialEq, serde::Deserialize)]
    #[serde(rename_all = "snake_case")]
    enum EarlierErrorCode {
        Forbidden,
        #[serde(other)]
        Unknown,
    }

    #[test]
    fn a_comments_off_refusal_has_its_own_code_and_earlier_clients_read_it_as_unknown() {
        let refusal = ServerFrame::Error {
            code: FrameErrorCode::CommentsOff,
            message: "m".to_string(),
        };
        let wire = json!({ "type": "error", "code": "comments_off", "message": "m" });
        assert_server_wire(refusal, wire);
        assert_eq!(
            serde_json::from_value::<EarlierErrorCode>(json!("comments_off")).unwrap(),
            EarlierErrorCode::Unknown
        );
    }

    #[derive(Debug, PartialEq, serde::Deserialize)]
    #[serde(tag = "type", rename_all = "snake_case")]
    enum EarlierClientFrame {
        Hello {
            protocol: u32,
            device_id: DeviceId,
            access_token: String,
            nonce: String,
            signature: String,
        },
    }

    #[test]
    fn a_hello_can_name_the_error_codes_its_client_understands_and_earlier_servers_ignore_them() {
        let hello = ClientFrame::Hello {
            protocol: 1,
            device_id: DEVICE.parse().unwrap(),
            access_token: "at".to_string(),
            nonce: "n".to_string(),
            signature: "sig".to_string(),
            understands: vec![FrameErrorCode::CommentsOff],
        };
        let wire = json!({
            "type": "hello",
            "protocol": 1,
            "device_id": DEVICE,
            "access_token": "at",
            "nonce": "n",
            "signature": "sig",
            "understands": ["comments_off"]
        });
        assert_client_wire(hello, wire.clone());
        assert_eq!(
            serde_json::from_value::<EarlierClientFrame>(wire).unwrap(),
            EarlierClientFrame::Hello {
                protocol: 1,
                device_id: DEVICE.parse().unwrap(),
                access_token: "at".to_string(),
                nonce: "n".to_string(),
                signature: "sig".to_string(),
            }
        );
        let from_a_later_client = serde_json::from_value::<ClientFrame>(json!({
            "type": "hello",
            "protocol": 1,
            "device_id": DEVICE,
            "access_token": "at",
            "nonce": "n",
            "signature": "sig",
            "understands": ["comments_off", "a_code_from_the_future"]
        }))
        .unwrap();
        assert!(matches!(
            from_a_later_client,
            ClientFrame::Hello { understands, .. }
                if understands == vec![FrameErrorCode::CommentsOff, FrameErrorCode::Unknown]
        ));
    }
}
