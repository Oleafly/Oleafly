// Serde reads an internally tagged enum by first copying the whole frame into
// a tree of its own, which for a padded frame costs many times its size.
// These parsers read `type` alone, then only the fields of that frame, and
// skip everything else without keeping it.

use std::borrow::Cow;

use serde::Deserialize;

use super::{ClientFrame, CommentSwitches, FrameErrorCode, MemberChange, ServerFrame};
use crate::auth::SessionEndReason;
use crate::envelope::Envelope;
use crate::ids::{AccountId, BatchId, DeviceId, ServerId, SharedProjectId};
use crate::projects::PresenceState;
use crate::roles::ProjectRole;

#[derive(Deserialize)]
struct Tag<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>,
}

fn kind(text: &str) -> Result<Cow<'_, str>, serde_json::Error> {
    serde_json::from_str::<Tag>(text).map(|tag| tag.kind)
}

fn body<'a, T: Deserialize<'a>>(text: &'a str) -> Result<T, serde_json::Error> {
    serde_json::from_str(text)
}

#[derive(Deserialize)]
struct HelloBody {
    protocol: u32,
    device_id: DeviceId,
    access_token: String,
    nonce: String,
    signature: String,
    #[serde(default)]
    understands: Vec<FrameErrorCode>,
}

#[derive(Deserialize)]
struct IdBody {
    id: u64,
}

#[derive(Deserialize)]
struct ProjectBody {
    project_id: SharedProjectId,
}

#[derive(Deserialize)]
struct SubscribeBody {
    project_id: SharedProjectId,
    since_seq: u64,
}

#[derive(Deserialize)]
struct SentUpdateBody {
    project_id: SharedProjectId,
    envelope: Envelope,
}

#[derive(Deserialize)]
struct SentPresenceBody {
    project_id: SharedProjectId,
    state: PresenceState,
}

impl ClientFrame {
    pub fn from_json(text: &str) -> Result<ClientFrame, serde_json::Error> {
        Ok(match kind(text)?.as_ref() {
            "hello" => {
                let hello: HelloBody = body(text)?;
                ClientFrame::Hello {
                    protocol: hello.protocol,
                    device_id: hello.device_id,
                    access_token: hello.access_token,
                    nonce: hello.nonce,
                    signature: hello.signature,
                    understands: hello.understands,
                }
            }
            "ping" => ClientFrame::Ping {
                id: body::<IdBody>(text)?.id,
            },
            "subscribe" => {
                let subscribe: SubscribeBody = body(text)?;
                ClientFrame::Subscribe {
                    project_id: subscribe.project_id,
                    since_seq: subscribe.since_seq,
                }
            }
            "unsubscribe" => ClientFrame::Unsubscribe {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            "update" => {
                let update: SentUpdateBody = body(text)?;
                ClientFrame::Update {
                    project_id: update.project_id,
                    envelope: update.envelope,
                }
            }
            "presence" => {
                let presence: SentPresenceBody = body(text)?;
                ClientFrame::Presence {
                    project_id: presence.project_id,
                    state: presence.state,
                }
            }
            "presence_leave" => ClientFrame::PresenceLeave {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            _ => ClientFrame::Unknown,
        })
    }
}

#[derive(Deserialize)]
struct ChallengeBody {
    nonce: String,
    server_id: ServerId,
}

#[derive(Deserialize)]
struct WelcomeBody {
    protocol: u32,
    account_id: AccountId,
}

#[derive(Deserialize)]
struct ErrorBody {
    code: FrameErrorCode,
    message: String,
}

#[derive(Deserialize)]
struct RevokedBody {
    #[serde(default)]
    reason: Option<SessionEndReason>,
}

#[derive(Deserialize)]
struct SubscribedBody {
    project_id: SharedProjectId,
    role: ProjectRole,
    head_seq: u64,
    #[serde(default)]
    since_batch: Option<BatchId>,
}

#[derive(Deserialize)]
struct UpdateBody {
    project_id: SharedProjectId,
    seq: u64,
    #[serde(default)]
    account_id: Option<AccountId>,
    envelope: Envelope,
}

#[derive(Deserialize)]
struct AckBody {
    project_id: SharedProjectId,
    batch_id: BatchId,
    seq: u64,
}

#[derive(Deserialize)]
struct PresenceBody {
    project_id: SharedProjectId,
    device_id: DeviceId,
    account_id: AccountId,
    state: PresenceState,
}

#[derive(Deserialize)]
struct PresenceLeftBody {
    project_id: SharedProjectId,
    device_id: DeviceId,
}

#[derive(Deserialize)]
struct AccessChangedBody {
    project_id: SharedProjectId,
    role: Option<ProjectRole>,
    #[serde(default)]
    change: Option<MemberChange>,
    #[serde(default)]
    comments: Option<CommentSwitches>,
}

impl ServerFrame {
    pub fn from_json(text: &str) -> Result<ServerFrame, serde_json::Error> {
        Ok(match kind(text)?.as_ref() {
            "challenge" => {
                let challenge: ChallengeBody = body(text)?;
                ServerFrame::Challenge {
                    nonce: challenge.nonce,
                    server_id: challenge.server_id,
                }
            }
            "welcome" => {
                let welcome: WelcomeBody = body(text)?;
                ServerFrame::Welcome {
                    protocol: welcome.protocol,
                    account_id: welcome.account_id,
                }
            }
            "pong" => ServerFrame::Pong {
                id: body::<IdBody>(text)?.id,
            },
            "error" => {
                let error: ErrorBody = body(text)?;
                ServerFrame::Error {
                    code: error.code,
                    message: error.message,
                }
            }
            "session_revoked" => ServerFrame::SessionRevoked {
                reason: body::<RevokedBody>(text)?.reason,
            },
            "subscribed" => {
                let subscribed: SubscribedBody = body(text)?;
                ServerFrame::Subscribed {
                    project_id: subscribed.project_id,
                    role: subscribed.role,
                    head_seq: subscribed.head_seq,
                    since_batch: subscribed.since_batch,
                }
            }
            "update" => {
                let update: UpdateBody = body(text)?;
                ServerFrame::Update {
                    project_id: update.project_id,
                    seq: update.seq,
                    account_id: update.account_id,
                    envelope: update.envelope,
                }
            }
            "ack" => {
                let ack: AckBody = body(text)?;
                ServerFrame::Ack {
                    project_id: ack.project_id,
                    batch_id: ack.batch_id,
                    seq: ack.seq,
                }
            }
            "snapshot_required" => ServerFrame::SnapshotRequired {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            "presence" => {
                let presence: PresenceBody = body(text)?;
                ServerFrame::Presence {
                    project_id: presence.project_id,
                    device_id: presence.device_id,
                    account_id: presence.account_id,
                    state: presence.state,
                }
            }
            "presence_left" => {
                let left: PresenceLeftBody = body(text)?;
                ServerFrame::PresenceLeft {
                    project_id: left.project_id,
                    device_id: left.device_id,
                }
            }
            "access_changed" => {
                let changed: AccessChangedBody = body(text)?;
                ServerFrame::AccessChanged {
                    project_id: changed.project_id,
                    role: changed.role,
                    change: changed.change,
                    comments: changed.comments,
                }
            }
            "project_archived" => ServerFrame::ProjectArchived {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            _ => ServerFrame::Unknown,
        })
    }
}
