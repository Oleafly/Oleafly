// Serde reads an internally tagged enum by first copying the whole frame into
// a tree of its own, which for a padded frame costs many times its size.
// These parsers read `type` alone, then only the fields of that frame, and
// skip everything else without keeping it. The type is read into a fieldless
// kind, so even an escaped type name is never copied into a string.

use serde::Deserialize;

use super::{ClientFrame, CommentSwitches, FrameErrorCode, MemberChange, ServerFrame};
use crate::auth::SessionEndReason;
use crate::envelope::Envelope;
use crate::ids::{AccountId, BatchId, DeviceId, ServerId, SharedProjectId};
use crate::projects::PresenceState;
use crate::roles::ProjectRole;

#[derive(Deserialize)]
struct Tag<K> {
    #[serde(rename = "type")]
    kind: K,
}

fn kind<'a, K: Deserialize<'a>>(text: &'a str) -> Result<K, serde_json::Error> {
    serde_json::from_str::<Tag<K>>(text).map(|tag| tag.kind)
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ClientKind {
    Hello,
    Ping,
    Subscribe,
    Unsubscribe,
    Update,
    Presence,
    PresenceLeave,
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum ServerKind {
    Challenge,
    Welcome,
    Pong,
    Error,
    SessionRevoked,
    Subscribed,
    Update,
    Ack,
    SnapshotRequired,
    Presence,
    PresenceLeft,
    AccessChanged,
    ProjectArchived,
    #[serde(other)]
    Other,
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
        Ok(match kind::<ClientKind>(text)? {
            ClientKind::Hello => {
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
            ClientKind::Ping => ClientFrame::Ping {
                id: body::<IdBody>(text)?.id,
            },
            ClientKind::Subscribe => {
                let subscribe: SubscribeBody = body(text)?;
                ClientFrame::Subscribe {
                    project_id: subscribe.project_id,
                    since_seq: subscribe.since_seq,
                }
            }
            ClientKind::Unsubscribe => ClientFrame::Unsubscribe {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            ClientKind::Update => {
                let update: SentUpdateBody = body(text)?;
                ClientFrame::Update {
                    project_id: update.project_id,
                    envelope: update.envelope,
                }
            }
            ClientKind::Presence => {
                let presence: SentPresenceBody = body(text)?;
                ClientFrame::Presence {
                    project_id: presence.project_id,
                    state: presence.state,
                }
            }
            ClientKind::PresenceLeave => ClientFrame::PresenceLeave {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            ClientKind::Other => ClientFrame::Unknown,
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
        Ok(match kind::<ServerKind>(text)? {
            ServerKind::Challenge => {
                let challenge: ChallengeBody = body(text)?;
                ServerFrame::Challenge {
                    nonce: challenge.nonce,
                    server_id: challenge.server_id,
                }
            }
            ServerKind::Welcome => {
                let welcome: WelcomeBody = body(text)?;
                ServerFrame::Welcome {
                    protocol: welcome.protocol,
                    account_id: welcome.account_id,
                }
            }
            ServerKind::Pong => ServerFrame::Pong {
                id: body::<IdBody>(text)?.id,
            },
            ServerKind::Error => {
                let error: ErrorBody = body(text)?;
                ServerFrame::Error {
                    code: error.code,
                    message: error.message,
                }
            }
            ServerKind::SessionRevoked => ServerFrame::SessionRevoked {
                reason: body::<RevokedBody>(text)?.reason,
            },
            ServerKind::Subscribed => {
                let subscribed: SubscribedBody = body(text)?;
                ServerFrame::Subscribed {
                    project_id: subscribed.project_id,
                    role: subscribed.role,
                    head_seq: subscribed.head_seq,
                    since_batch: subscribed.since_batch,
                }
            }
            ServerKind::Update => {
                let update: UpdateBody = body(text)?;
                ServerFrame::Update {
                    project_id: update.project_id,
                    seq: update.seq,
                    account_id: update.account_id,
                    envelope: update.envelope,
                }
            }
            ServerKind::Ack => {
                let ack: AckBody = body(text)?;
                ServerFrame::Ack {
                    project_id: ack.project_id,
                    batch_id: ack.batch_id,
                    seq: ack.seq,
                }
            }
            ServerKind::SnapshotRequired => ServerFrame::SnapshotRequired {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            ServerKind::Presence => {
                let presence: PresenceBody = body(text)?;
                ServerFrame::Presence {
                    project_id: presence.project_id,
                    device_id: presence.device_id,
                    account_id: presence.account_id,
                    state: presence.state,
                }
            }
            ServerKind::PresenceLeft => {
                let left: PresenceLeftBody = body(text)?;
                ServerFrame::PresenceLeft {
                    project_id: left.project_id,
                    device_id: left.device_id,
                }
            }
            ServerKind::AccessChanged => {
                let changed: AccessChangedBody = body(text)?;
                ServerFrame::AccessChanged {
                    project_id: changed.project_id,
                    role: changed.role,
                    change: changed.change,
                    comments: changed.comments,
                }
            }
            ServerKind::ProjectArchived => ServerFrame::ProjectArchived {
                project_id: body::<ProjectBody>(text)?.project_id,
            },
            ServerKind::Other => ServerFrame::Unknown,
        })
    }
}
