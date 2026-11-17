use oleafly_collab::sync::LiveStatus;
use oleafly_collab_protocol::frames::MemberChangeKind;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::projects::{PresenceActivity, PresenceActivityKind, ProjectRole};
use serde::{Deserialize, Serialize};

pub const LIVE_STATUS_EVENT: &str = "collab-live-status";
pub const LIVE_ROLE_EVENT: &str = "collab-live-role";
pub const LIVE_MERGED_EVENT: &str = "collab-live-merged";
pub const PRESENCE_EVENT: &str = "collab-presence";
pub const PRESENCE_LEFT_EVENT: &str = "collab-presence-left";
pub const LIVE_NEW_DEVICE_EVENT: &str = "collab-live-new-device";
pub const LIVE_MEMBERS_EVENT: &str = "collab-live-members";
pub const CHANGE_SKIPPED_EVENT: &str = "collab-change-skipped";
pub const PROJECT_FULL_EVENT: &str = "collab-live-project-full";
pub const LIVE_WRITTEN_EVENT: &str = "collab-live-written";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenFile {
    pub path: String,
    pub hash: String,
    pub crlf: bool,
    pub length: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WrittenPayload {
    pub project_id: String,
    pub files: Vec<WrittenFile>,
}

pub(super) fn window_hash(bytes: &[u8]) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusPayload {
    pub project_id: String,
    pub status: LiveStatus,
    pub pending: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RolePayload {
    pub project_id: String,
    pub role: ProjectRole,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MergedFile {
    pub path: String,
    pub changes: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedAuthor {
    pub account_id: AccountId,
    pub files: Vec<MergedFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct MergeMarks {
    pub before: String,
    pub after: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergedPayload {
    pub project_id: String,
    pub files: Vec<MergedFile>,
    pub authors: Vec<MergedAuthor>,
    pub review: MergeMarks,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDevicePayload {
    pub project_id: String,
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MembersPayload {
    pub project_id: String,
    pub account_id: AccountId,
    pub by: AccountId,
    pub kind: MemberChangeKind,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeSkippedPayload {
    pub project_id: String,
    pub seq: u64,
    pub device_id: Option<DeviceId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectFullPayload {
    pub project_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub project_id: String,
    pub device_id: DeviceId,
    pub account_id: AccountId,
    pub path: Option<String>,
    pub cursor: Option<u32>,
    pub anchor: Option<u32>,
    pub activity: Option<ActivityPayload>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityPayload {
    pub kind: PresenceActivityKind,
    #[serde(default)]
    pub thread_id: Option<String>,
}

impl ActivityPayload {
    pub fn shown(activity: Option<PresenceActivity>) -> Option<ActivityPayload> {
        activity
            .filter(|activity| activity.kind != PresenceActivityKind::Unknown)
            .map(|activity| ActivityPayload {
                kind: activity.kind,
                thread_id: activity.thread_id,
            })
    }

    pub fn sent(activity: Option<ActivityPayload>) -> Option<PresenceActivity> {
        activity
            .filter(|activity| activity.kind != PresenceActivityKind::Unknown)
            .map(|activity| PresenceActivity {
                kind: activity.kind,
                thread_id: activity.thread_id.filter(|thread| thread.len() <= 256),
            })
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceLeftPayload {
    pub project_id: String,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, Serialize)]
pub struct LiveInfo {
    pub role: ProjectRole,
    pub account_id: AccountId,
    pub device_id: DeviceId,
}

#[derive(Clone, Debug, Serialize)]
pub struct DocOpened {
    pub file_id: String,
    pub rev: u64,
    pub text: String,
    pub session: u64,
}
