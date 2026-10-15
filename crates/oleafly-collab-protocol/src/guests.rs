use serde::{Deserialize, Serialize};

use crate::ids::SharedProjectId;
use crate::projects::PersonSummary;
use crate::roles::ProjectRole;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GuestInvitationStatus {
    AwaitingApproval,
    Invited,
    Accepted,
    Declined,
    Revoked,
    Expired,
    #[serde(other)]
    Unknown,
}

impl GuestInvitationStatus {
    pub fn is_open(self) -> bool {
        matches!(
            self,
            GuestInvitationStatus::AwaitingApproval | GuestInvitationStatus::Invited
        )
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewGuestInvitation {
    pub email: String,
    pub role: ProjectRole,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestInvitation {
    pub id: String,
    pub project_id: SharedProjectId,
    pub project_title: String,
    pub email: String,
    pub role: ProjectRole,
    pub status: GuestInvitationStatus,
    pub invited_by: PersonSummary,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectGuestInvitations {
    #[serde(default)]
    pub guests_enabled: bool,
    #[serde(default)]
    pub approval_required: bool,
    #[serde(default)]
    pub sends_email: bool,
    pub add_link: String,
    #[serde(default)]
    pub invitations: Vec<GuestInvitation>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct GuestInviteResult {
    pub invitation: GuestInvitation,
    #[serde(default)]
    pub emailed: bool,
    pub add_link: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";
    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";

    fn invitation() -> GuestInvitation {
        GuestInvitation {
            id: "inv-1".to_string(),
            project_id: PROJECT.parse().unwrap(),
            project_title: "Reef survey".to_string(),
            email: "dana@field.org".to_string(),
            role: ProjectRole::Viewer,
            status: GuestInvitationStatus::AwaitingApproval,
            invited_by: PersonSummary {
                account_id: ACCOUNT.parse().unwrap(),
                display_name: "Ada".to_string(),
                avatar_url: None,
                email: None,
                login: Some("ada".to_string()),
                guest: false,
                active: true,
            },
            created_at: 5,
            expires_at: 9,
        }
    }

    fn invitation_json() -> serde_json::Value {
        json!({
            "id": "inv-1",
            "project_id": PROJECT,
            "project_title": "Reef survey",
            "email": "dana@field.org",
            "role": "viewer",
            "status": "awaiting_approval",
            "invited_by": {
                "account_id": ACCOUNT,
                "display_name": "Ada",
                "avatar_url": null,
                "email": null,
                "login": "ada"
            },
            "created_at": 5,
            "expires_at": 9
        })
    }

    #[test]
    fn an_invitation_matches_its_wire_json() {
        assert_eq!(
            serde_json::to_value(invitation()).unwrap(),
            invitation_json()
        );
        assert_eq!(
            serde_json::from_value::<GuestInvitation>(invitation_json()).unwrap(),
            invitation()
        );
    }

    #[test]
    fn statuses_use_snake_case_and_a_newer_one_reads_as_unknown() {
        for (status, name) in [
            (GuestInvitationStatus::AwaitingApproval, "awaiting_approval"),
            (GuestInvitationStatus::Invited, "invited"),
            (GuestInvitationStatus::Accepted, "accepted"),
            (GuestInvitationStatus::Declined, "declined"),
            (GuestInvitationStatus::Revoked, "revoked"),
            (GuestInvitationStatus::Expired, "expired"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<GuestInvitationStatus>(json!(name)).unwrap(),
                status
            );
        }
        assert_eq!(
            serde_json::from_value::<GuestInvitationStatus>(json!("parked")).unwrap(),
            GuestInvitationStatus::Unknown
        );
        assert!(GuestInvitationStatus::AwaitingApproval.is_open());
        assert!(GuestInvitationStatus::Invited.is_open());
        assert!(!GuestInvitationStatus::Accepted.is_open());
        assert!(!GuestInvitationStatus::Declined.is_open());
    }

    #[test]
    fn requests_lists_and_results_round_trip() {
        let request = NewGuestInvitation {
            email: "dana@field.org".to_string(),
            role: ProjectRole::Editor,
        };
        assert_eq!(
            serde_json::to_value(&request).unwrap(),
            json!({ "email": "dana@field.org", "role": "editor" })
        );
        let list = ProjectGuestInvitations {
            guests_enabled: true,
            approval_required: true,
            sends_email: false,
            add_link: "oleafly://server/add?url=https%3A%2F%2Fcollab.test".to_string(),
            invitations: vec![invitation()],
        };
        let wire = serde_json::to_value(&list).unwrap();
        assert_eq!(wire["sends_email"], json!(false));
        assert_eq!(wire["invitations"][0], invitation_json());
        assert_eq!(
            serde_json::from_value::<ProjectGuestInvitations>(wire).unwrap(),
            list
        );
        let result = GuestInviteResult {
            invitation: invitation(),
            emailed: false,
            add_link: "oleafly://server/add?url=x".to_string(),
        };
        let wire = serde_json::to_value(&result).unwrap();
        assert_eq!(
            serde_json::from_value::<GuestInviteResult>(wire).unwrap(),
            result
        );
    }
}
