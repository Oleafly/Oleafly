use crate::auth::AccountSummary;
use crate::ids::AccountId;
use crate::roles::ServerRole;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AllowlistMatcher {
    Email { email: String },
    ProviderLogin { provider: String, login: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AllowlistEntry {
    pub id: String,
    pub matcher: AllowlistMatcher,
    pub role: ServerRole,
    pub created_at: i64,
    pub bound_account: Option<AccountId>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewAllowlistEntry {
    pub matcher: AllowlistMatcher,
    pub role: ServerRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MemberStatus {
    Active,
    Suspended,
    Removed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberSummary {
    pub account: AccountSummary,
    pub status: MemberStatus,
    pub created_at: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemberPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<ServerRole>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<MemberStatus>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DomainRule {
    pub id: String,
    pub domain: String,
    pub role: ServerRole,
    pub created_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NewDomainRule {
    pub domain: String,
    pub role: ServerRole,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeSettings {
    pub guests_enabled: bool,
    pub guest_approval_required: bool,
    pub directory_visible: bool,
    pub directory_shows_email: bool,
    pub link_sharing_allowed: bool,
    pub access_logs_allowed: bool,
    pub email_notifications: bool,
    pub comments_allowed: bool,
}

impl Default for RuntimeSettings {
    fn default() -> Self {
        RuntimeSettings {
            guests_enabled: false,
            guest_approval_required: true,
            directory_visible: true,
            directory_shows_email: true,
            link_sharing_allowed: true,
            access_logs_allowed: true,
            email_notifications: true,
            comments_allowed: true,
        }
    }
}

impl RuntimeSettings {
    pub fn apply(&mut self, patch: &RuntimeSettingsPatch) {
        let fields = [
            (&mut self.guests_enabled, patch.guests_enabled),
            (
                &mut self.guest_approval_required,
                patch.guest_approval_required,
            ),
            (&mut self.directory_visible, patch.directory_visible),
            (&mut self.directory_shows_email, patch.directory_shows_email),
            (&mut self.link_sharing_allowed, patch.link_sharing_allowed),
            (&mut self.access_logs_allowed, patch.access_logs_allowed),
            (&mut self.email_notifications, patch.email_notifications),
            (&mut self.comments_allowed, patch.comments_allowed),
        ];
        for (field, value) in fields {
            if let Some(value) = value {
                *field = value;
            }
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeSettingsPatch {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guests_enabled: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub guest_approval_required: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_visible: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub directory_shows_email: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub link_sharing_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub access_logs_allowed: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email_notifications: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comments_allowed: Option<bool>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecurityEventKind {
    SetupCompleted,
    SignIn,
    SignInRefused,
    DeviceAdded,
    DeviceSignedOut,
    RefreshReuseDetected,
    MemberAdded,
    MemberRemoved,
    MemberSuspended,
    MemberReactivated,
    RoleChanged,
    AllowlistAdded,
    AllowlistRemoved,
    DomainRuleAdded,
    DomainRuleRemoved,
    SettingsChanged,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SecurityEvent {
    pub id: i64,
    pub at: i64,
    pub actor: Option<AccountId>,
    pub kind: SecurityEventKind,
    pub target: Option<String>,
    pub ip: Option<String>,
    pub detail: serde_json::Value,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Page<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";

    #[test]
    fn runtime_settings_default_to_the_documented_values() {
        assert_eq!(
            RuntimeSettings::default(),
            RuntimeSettings {
                guests_enabled: false,
                guest_approval_required: true,
                directory_visible: true,
                directory_shows_email: true,
                link_sharing_allowed: true,
                access_logs_allowed: true,
                email_notifications: true,
                comments_allowed: true,
            }
        );
        assert_eq!(
            serde_json::to_value(RuntimeSettings::default()).unwrap(),
            json!({
                "guests_enabled": false,
                "guest_approval_required": true,
                "directory_visible": true,
                "directory_shows_email": true,
                "link_sharing_allowed": true,
                "access_logs_allowed": true,
                "email_notifications": true,
                "comments_allowed": true
            })
        );
    }

    #[test]
    fn a_patch_changes_only_the_fields_it_names() {
        let patch: RuntimeSettingsPatch =
            serde_json::from_str(r#"{"guests_enabled":true,"comments_allowed":false}"#).unwrap();
        assert_eq!(
            patch,
            RuntimeSettingsPatch {
                guests_enabled: Some(true),
                comments_allowed: Some(false),
                ..RuntimeSettingsPatch::default()
            }
        );
        let mut settings = RuntimeSettings::default();
        settings.apply(&patch);
        assert_eq!(
            settings,
            RuntimeSettings {
                guests_enabled: true,
                comments_allowed: false,
                ..RuntimeSettings::default()
            }
        );
        assert_eq!(
            serde_json::to_string(&RuntimeSettingsPatch::default()).unwrap(),
            "{}"
        );
        assert_eq!(
            serde_json::to_value(patch).unwrap(),
            json!({ "guests_enabled": true, "comments_allowed": false })
        );
    }

    #[test]
    fn every_settings_field_can_be_patched() {
        let flipped = RuntimeSettingsPatch {
            guests_enabled: Some(true),
            guest_approval_required: Some(false),
            directory_visible: Some(false),
            directory_shows_email: Some(false),
            link_sharing_allowed: Some(false),
            access_logs_allowed: Some(false),
            email_notifications: Some(false),
            comments_allowed: Some(false),
        };
        let mut settings = RuntimeSettings::default();
        settings.apply(&flipped);
        assert_eq!(
            settings,
            RuntimeSettings {
                guests_enabled: true,
                guest_approval_required: false,
                directory_visible: false,
                directory_shows_email: false,
                link_sharing_allowed: false,
                access_logs_allowed: false,
                email_notifications: false,
                comments_allowed: false,
            }
        );
    }

    #[test]
    fn allowlist_matchers_are_tagged_by_kind() {
        let email = AllowlistMatcher::Email {
            email: "Alice@Uni.EDU".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&email).unwrap(),
            json!({ "kind": "email", "email": "Alice@Uni.EDU" })
        );
        let login: AllowlistMatcher = serde_json::from_str(
            r#"{"kind":"provider_login","provider":"github","login":"Alice-Chen"}"#,
        )
        .unwrap();
        assert_eq!(
            login,
            AllowlistMatcher::ProviderLogin {
                provider: "github".to_string(),
                login: "Alice-Chen".to_string(),
            }
        );
        assert!(serde_json::from_str::<AllowlistMatcher>(
            r#"{"kind":"domain","domain":"uni.edu"}"#
        )
        .is_err());
        let entry = AllowlistEntry {
            id: "a1".to_string(),
            matcher: email,
            role: ServerRole::Member,
            created_at: 5,
            bound_account: None,
        };
        assert_eq!(
            serde_json::to_value(entry).unwrap(),
            json!({
                "id": "a1",
                "matcher": { "kind": "email", "email": "Alice@Uni.EDU" },
                "role": "member",
                "created_at": 5,
                "bound_account": null
            })
        );
        let new_entry: NewAllowlistEntry = serde_json::from_str(
            r#"{"matcher":{"kind":"email","email":"bob@uni.edu"},"role":"maintainer"}"#,
        )
        .unwrap();
        assert_eq!(new_entry.role, ServerRole::Maintainer);
    }

    #[test]
    fn members_and_domain_rules_match_the_wire_json() {
        let patch: MemberPatch = serde_json::from_str(r#"{"status":"suspended"}"#).unwrap();
        assert_eq!(
            patch,
            MemberPatch {
                role: None,
                status: Some(MemberStatus::Suspended),
            }
        );
        assert_eq!(
            serde_json::to_string(&patch).unwrap(),
            r#"{"status":"suspended"}"#
        );
        let summary_json = json!({
            "account": {
                "account_id": ACCOUNT,
                "display_name": "Alice Chen",
                "avatar_url": null,
                "server_role": "member",
                "emails": [],
                "logins": ["alice-chen"]
            },
            "status": "active",
            "created_at": 9
        });
        let summary: MemberSummary = serde_json::from_value(summary_json.clone()).unwrap();
        assert_eq!(summary.status, MemberStatus::Active);
        assert_eq!(serde_json::to_value(summary).unwrap(), summary_json);
        let rule: DomainRule = serde_json::from_str(
            r#"{"id":"d1","domain":"cs.uni.edu","role":"member","created_at":3}"#,
        )
        .unwrap();
        assert_eq!(rule.domain, "cs.uni.edu");
        let new_rule = NewDomainRule {
            domain: "uni.edu".to_string(),
            role: ServerRole::Guest,
        };
        assert_eq!(
            serde_json::to_value(new_rule).unwrap(),
            json!({ "domain": "uni.edu", "role": "guest" })
        );
    }

    #[test]
    fn member_statuses_round_trip_including_removed() {
        for (status, name) in [
            (MemberStatus::Active, "active"),
            (MemberStatus::Suspended, "suspended"),
            (MemberStatus::Removed, "removed"),
        ] {
            assert_eq!(serde_json::to_value(status).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<MemberStatus>(json!(name)).unwrap(),
                status
            );
        }
        let patch: MemberPatch = serde_json::from_str(r#"{"status":"removed"}"#).unwrap();
        assert_eq!(patch.status, Some(MemberStatus::Removed));
        assert_eq!(
            serde_json::to_string(&patch).unwrap(),
            r#"{"status":"removed"}"#
        );
        assert!(serde_json::from_value::<MemberStatus>(json!("deleted")).is_err());
    }

    #[test]
    fn security_event_kinds_use_snake_case() {
        let kinds = [
            (SecurityEventKind::SetupCompleted, "setup_completed"),
            (SecurityEventKind::SignIn, "sign_in"),
            (SecurityEventKind::SignInRefused, "sign_in_refused"),
            (SecurityEventKind::DeviceAdded, "device_added"),
            (SecurityEventKind::DeviceSignedOut, "device_signed_out"),
            (
                SecurityEventKind::RefreshReuseDetected,
                "refresh_reuse_detected",
            ),
            (SecurityEventKind::MemberAdded, "member_added"),
            (SecurityEventKind::MemberRemoved, "member_removed"),
            (SecurityEventKind::MemberSuspended, "member_suspended"),
            (SecurityEventKind::MemberReactivated, "member_reactivated"),
            (SecurityEventKind::RoleChanged, "role_changed"),
            (SecurityEventKind::AllowlistAdded, "allowlist_added"),
            (SecurityEventKind::AllowlistRemoved, "allowlist_removed"),
            (SecurityEventKind::DomainRuleAdded, "domain_rule_added"),
            (SecurityEventKind::DomainRuleRemoved, "domain_rule_removed"),
            (SecurityEventKind::SettingsChanged, "settings_changed"),
            (SecurityEventKind::Unknown, "unknown"),
        ];
        for (kind, name) in kinds {
            assert_eq!(serde_json::to_value(kind).unwrap(), name);
            assert_eq!(
                serde_json::from_value::<SecurityEventKind>(json!(name)).unwrap(),
                kind
            );
        }
        assert_eq!(
            serde_json::from_value::<SecurityEventKind>(json!("project_shared")).unwrap(),
            SecurityEventKind::Unknown
        );
        let event: SecurityEvent = serde_json::from_value(json!({
            "id": 1,
            "at": 2,
            "actor": null,
            "kind": "grant_changed",
            "target": null,
            "ip": null,
            "detail": {}
        }))
        .unwrap();
        assert_eq!(event.kind, SecurityEventKind::Unknown);
    }

    #[test]
    fn a_security_log_page_round_trips() {
        let wire = json!({
            "items": [{
                "id": 7,
                "at": 1_760_000_000_000_i64,
                "actor": ACCOUNT,
                "kind": "role_changed",
                "target": "01920000-0000-7000-8000-000000000004",
                "ip": "203.0.113.9",
                "detail": { "from": "member", "to": "maintainer" }
            }],
            "next_cursor": "7"
        });
        let page: Page<SecurityEvent> = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(page.items[0].kind, SecurityEventKind::RoleChanged);
        assert_eq!(
            page.items[0].actor,
            Some(ACCOUNT.parse::<AccountId>().unwrap())
        );
        assert_eq!(page.next_cursor.as_deref(), Some("7"));
        assert_eq!(serde_json::to_value(page).unwrap(), wire);
    }
}
