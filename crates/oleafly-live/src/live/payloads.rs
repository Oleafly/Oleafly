use oleafly_collab::sync::LiveStatus;
use oleafly_collab_protocol::projects::{PresenceActivity, PresenceActivityKind, ProjectRole};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TypedAs {
    pub user_id: String,
    pub email: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocPendingPayload {
    pub project_id: String,
    pub path: String,
    pub pending: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountChangedPayload {
    pub project_id: String,
    pub typed_as: TypedAs,
    pub files: Vec<KeptFile>,
}

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

pub fn window_hash(bytes: &[u8]) -> String {
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
    pub tracking: bool,
    pub restricted: bool,
    pub deleted_externally: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresencePayload {
    pub project_id: String,
    pub device_id: String,
    pub account_id: String,
    pub path: Option<String>,
    pub cursor: Option<u32>,
    pub anchor: Option<u32>,
    pub person: Option<PresencePerson>,
    pub activity: Option<ActivityPayload>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct PresencePerson {
    pub name: Option<String>,
    pub email: Option<String>,
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
pub struct OverleafMembersPayload {
    pub project_id: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemberStanding {
    Member,
    Invited,
    Former,
    Unlisted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OverleafMember {
    pub person: OverleafPerson,
    pub role: ProjectRole,
    pub granted_at: i64,
    pub standing: MemberStanding,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct OverleafPerson {
    pub account_id: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub email: Option<String>,
    pub login: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresenceLeftPayload {
    pub project_id: String,
    pub device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderChange {
    pub project_id: String,
    pub paths: Vec<String>,
    pub rescan: bool,
    pub structural: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub renamed: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub deleted: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum KeptKind {
    Replaced,
    Added,
    Beside,
    Unsent,
    Differed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptFile {
    pub id: String,
    pub path: String,
    pub copy: Option<String>,
    pub kind: KeptKind,
    pub by: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptPayload {
    pub project_id: String,
    pub files: Vec<KeptFile>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UploadState {
    Waiting,
    Failed,
    TooLarge,
    ProjectTooLarge,
    AccountStorageFull,
    TooManyUploads,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadFile {
    pub path: String,
    pub state: UploadState,
    pub size: u64,
    pub limit: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UploadsPayload {
    pub project_id: String,
    pub files: Vec<UploadFile>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub project_id: String,
    pub path: String,
    pub done: u64,
    pub total: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEditPayload {
    pub project_id: String,
    pub path: String,
    pub user_id: Option<String>,
}
