use serde::{Deserialize, Serialize};

use crate::ids::{AccountId, SharedProjectId};
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
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectMember {
    pub person: PersonSummary,
    pub role: ProjectRole,
    pub granted_at: i64,
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
        }
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
                "head_seq": 12
            }),
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
            },
            json!({ "link_sharing": true, "link_role": "editor" }),
        );
        round_trip(
            MemberGrant {
                role: ProjectRole::Viewer,
            },
            json!({ "role": "viewer" }),
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
}
