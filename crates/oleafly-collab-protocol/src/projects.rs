use serde::{Deserialize, Serialize};

use crate::ids::{AccountId, DeviceId, SharedProjectId};
pub use crate::roles::ProjectRole;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectStatus {
    Pending,
    Active,
    Archived,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PersonSummary {
    pub account_id: AccountId,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub email: Option<String>,
    pub login: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub guest: bool,
}

fn is_false(value: &bool) -> bool {
    !*value
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectSummary {
    pub project_id: SharedProjectId,
    pub title: String,
    pub owner: PersonSummary,
    pub role: ProjectRole,
    pub status: ProjectStatus,
    pub created_at: i64,
    pub link_sharing: bool,
    pub link_role: ProjectRole,
    pub head_seq: u64,
    #[serde(default = "comments_on")]
    pub comments_enabled: bool,
    #[serde(default)]
    pub access_log: bool,
}

fn comments_on() -> bool {
    true
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectMember {
    pub person: PersonSummary,
    pub role: ProjectRole,
    pub granted_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectDevice {
    pub device_id: DeviceId,
    pub account_id: AccountId,
    pub public_key: String,
    pub added_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewProject {
    pub title: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_sharing: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_role: Option<ProjectRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_log: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberGrant {
    pub role: ProjectRole,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PresenceState {
    pub file_id: Option<String>,
    pub cursor: Option<u32>,
    pub anchor: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum ProjectAction {
    Read,
    Edit,
    UploadSnapshot,
    ManageMembers,
    ChangeLinkSharing,
    StopSharing,
}

pub fn project_role_allows(role: ProjectRole, action: ProjectAction) -> bool {
    match action {
        ProjectAction::Read => true,
        ProjectAction::Edit | ProjectAction::UploadSnapshot => {
            matches!(role, ProjectRole::Owner | ProjectRole::Editor)
        }
        ProjectAction::ManageMembers
        | ProjectAction::ChangeLinkSharing
        | ProjectAction::StopSharing => matches!(role, ProjectRole::Owner),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";
    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";

    fn round_trip<T>(value: T, wire: Value)
    where
        T: Serialize + for<'de> Deserialize<'de> + PartialEq + std::fmt::Debug,
    {
        assert_eq!(serde_json::to_value(&value).unwrap(), wire);
        assert_eq!(serde_json::from_value::<T>(wire).unwrap(), value);
    }

    fn carol() -> PersonSummary {
        PersonSummary {
            account_id: ACCOUNT.parse().unwrap(),
            display_name: "Carol Smith".to_string(),
            avatar_url: None,
            email: Some("carol@uni.edu".to_string()),
            login: Some("carol".to_string()),
            guest: false,
        }
    }

    #[test]
    fn a_guest_is_marked_and_everyone_else_keeps_the_old_wire_shape() {
        let guest = PersonSummary {
            guest: true,
            ..carol()
        };
        let wire = serde_json::to_value(&guest).unwrap();
        assert_eq!(wire["guest"], json!(true));
        assert_eq!(
            serde_json::from_value::<PersonSummary>(wire).unwrap(),
            guest
        );
        let member = serde_json::to_value(carol()).unwrap();
        assert!(member.get("guest").is_none());
        let older = json!({
            "account_id": ACCOUNT,
            "display_name": "Carol Smith",
            "avatar_url": null,
            "email": null,
            "login": null
        });
        assert!(
            !serde_json::from_value::<PersonSummary>(older)
                .unwrap()
                .guest
        );
    }

    #[test]
    fn a_project_summary_matches_its_wire_json() {
        round_trip(
            ProjectSummary {
                project_id: PROJECT.parse().unwrap(),
                title: "Grant proposal".to_string(),
                owner: carol(),
                role: ProjectRole::Editor,
                status: ProjectStatus::Active,
                created_at: 5,
                link_sharing: false,
                link_role: ProjectRole::Viewer,
                head_seq: 12,
                comments_enabled: false,
                access_log: true,
            },
            json!({
                "project_id": PROJECT,
                "title": "Grant proposal",
                "owner": {
                    "account_id": ACCOUNT,
                    "display_name": "Carol Smith",
                    "avatar_url": null,
                    "email": "carol@uni.edu",
                    "login": "carol"
                },
                "role": "editor",
                "status": "active",
                "created_at": 5,
                "link_sharing": false,
                "link_role": "viewer",
                "head_seq": 12,
                "comments_enabled": false,
                "access_log": true
            }),
        );
    }

    #[test]
    fn a_summary_from_an_older_server_allows_comments() {
        let older = json!({
            "project_id": PROJECT,
            "title": "Grant proposal",
            "owner": {
                "account_id": ACCOUNT,
                "display_name": "Carol Smith",
                "avatar_url": null,
                "email": null,
                "login": null
            },
            "role": "viewer",
            "status": "active",
            "created_at": 5,
            "link_sharing": false,
            "link_role": "viewer",
            "head_seq": 0
        });
        assert!(
            serde_json::from_value::<ProjectSummary>(older)
                .unwrap()
                .comments_enabled
        );
    }

    #[test]
    fn a_summary_from_an_older_server_keeps_no_access_log() {
        let older = json!({
            "project_id": PROJECT,
            "title": "Grant proposal",
            "owner": {
                "account_id": ACCOUNT,
                "display_name": "Carol Smith",
                "avatar_url": null,
                "email": null,
                "login": null
            },
            "role": "owner",
            "status": "active",
            "created_at": 5,
            "link_sharing": false,
            "link_role": "viewer",
            "head_seq": 0
        });
        assert!(
            !serde_json::from_value::<ProjectSummary>(older)
                .unwrap()
                .access_log
        );
    }

    #[test]
    fn an_access_log_switch_travels_alone_in_a_patch() {
        round_trip(
            ProjectPatch {
                access_log: Some(true),
                ..ProjectPatch::default()
            },
            json!({ "access_log": true }),
        );
    }

    #[test]
    fn a_newer_status_reads_as_unknown() {
        assert_eq!(
            serde_json::from_value::<ProjectStatus>(json!("frozen")).unwrap(),
            ProjectStatus::Unknown
        );
    }

    #[test]
    fn members_patches_and_new_projects_match_their_wire_json() {
        round_trip(
            ProjectMember {
                person: carol(),
                role: ProjectRole::Owner,
                granted_at: 9,
            },
            json!({
                "person": {
                    "account_id": ACCOUNT,
                    "display_name": "Carol Smith",
                    "avatar_url": null,
                    "email": "carol@uni.edu",
                    "login": "carol"
                },
                "role": "owner",
                "granted_at": 9
            }),
        );
        round_trip(
            NewProject {
                title: "Grant proposal".to_string(),
            },
            json!({ "title": "Grant proposal" }),
        );
        round_trip(
            ProjectPatch {
                title: None,
                link_sharing: Some(true),
                link_role: Some(ProjectRole::Editor),
                comments_enabled: None,
                access_log: None,
            },
            json!({ "link_sharing": true, "link_role": "editor" }),
        );
        round_trip(
            ProjectPatch {
                comments_enabled: Some(false),
                ..ProjectPatch::default()
            },
            json!({ "comments_enabled": false }),
        );
        round_trip(
            MemberGrant {
                role: ProjectRole::Viewer,
            },
            json!({ "role": "viewer" }),
        );
        round_trip(
            ProjectDevice {
                device_id: "01920000-0000-7000-8000-000000000003".parse().unwrap(),
                account_id: ACCOUNT.parse().unwrap(),
                public_key: "AQID".to_string(),
                added_at: 7,
            },
            json!({
                "device_id": "01920000-0000-7000-8000-000000000003",
                "account_id": ACCOUNT,
                "public_key": "AQID",
                "added_at": 7
            }),
        );
        round_trip(
            PresenceState {
                file_id: Some("f1".to_string()),
                cursor: Some(3),
                anchor: Some(1),
            },
            json!({ "file_id": "f1", "cursor": 3, "anchor": 1 }),
        );
    }

    #[test]
    fn project_roles_say_what_they_allow() {
        assert!(project_role_allows(
            ProjectRole::Owner,
            ProjectAction::ManageMembers
        ));
        assert!(!project_role_allows(
            ProjectRole::Editor,
            ProjectAction::ManageMembers
        ));
        assert!(project_role_allows(
            ProjectRole::Editor,
            ProjectAction::Edit
        ));
        assert!(!project_role_allows(
            ProjectRole::Viewer,
            ProjectAction::Edit
        ));
        assert!(project_role_allows(
            ProjectRole::Viewer,
            ProjectAction::Read
        ));
        assert!(project_role_allows(
            ProjectRole::Owner,
            ProjectAction::StopSharing
        ));
        assert!(!project_role_allows(
            ProjectRole::Editor,
            ProjectAction::StopSharing
        ));
        assert!(project_role_allows(
            ProjectRole::Editor,
            ProjectAction::UploadSnapshot
        ));
        assert!(!project_role_allows(
            ProjectRole::Viewer,
            ProjectAction::UploadSnapshot
        ));
    }

    #[test]
    fn a_project_role_from_a_later_server_reads_as_unknown_and_can_only_read() {
        let role: ProjectRole = serde_json::from_value(json!("commenter")).unwrap();
        assert_eq!(role, ProjectRole::Unknown);
        assert!(project_role_allows(role, ProjectAction::Read));
        for action in [
            ProjectAction::Edit,
            ProjectAction::UploadSnapshot,
            ProjectAction::ManageMembers,
            ProjectAction::ChangeLinkSharing,
            ProjectAction::StopSharing,
        ] {
            assert!(!project_role_allows(role, action), "{action:?}");
        }
        assert_eq!(serde_json::to_value(role).unwrap(), json!("unknown"));
        let summary = json!({
            "project_id": PROJECT,
            "title": "Grant proposal",
            "owner": serde_json::to_value(carol()).unwrap(),
            "role": "commenter",
            "status": "active",
            "created_at": 5,
            "link_sharing": true,
            "link_role": "commenter",
            "head_seq": 0
        });
        let read: ProjectSummary = serde_json::from_value(summary).unwrap();
        assert_eq!(
            (read.role, read.link_role),
            (ProjectRole::Unknown, ProjectRole::Unknown)
        );
    }
}
