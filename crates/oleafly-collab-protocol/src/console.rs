use serde::{Deserialize, Serialize};

use crate::admin::RuntimeSettings;
use crate::capabilities::{Limits, ProtocolRange, ProviderInfo};
use crate::ids::{AccountId, SharedProjectId};
use crate::projects::{PersonSummary, ProjectStatus};

pub const ADMIN_PROJECTS_PAGE_SIZE: u32 = 50;
pub const ADMIN_PROJECTS_MAX_PAGE_SIZE: u32 = 100;
pub const ADMIN_PROJECTS_MAX_QUERY_CHARS: usize = 200;
pub const ADMIN_PROJECTS_MAX_OFFSET: u32 = 1_000_000;
// How many UTC days, ending with today, the overview's activity covers.
pub const ACTIVITY_DAYS: u32 = 30;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
    Warning,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HealthIssue {
    NoSignInProvider,
    StorageNotWritable,
    SignInFailing,
    SignInEmailsPaused,
    CommentsChangedWhileOff,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct SignInProblem {
    pub provider: String,
    pub at: i64,
    pub reason: String,
}

// A change that turned out to change comments in a project with comments
// off. It could not be checked when it arrived, so it was stored and sent
// to the project's members before a later check found it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct CommentChangeWhileOff {
    pub project_id: SharedProjectId,
    #[serde(default)]
    pub project_title: Option<String>,
    #[serde(default)]
    pub account_id: Option<AccountId>,
    pub at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerHealth {
    pub status: HealthStatus,
    #[serde(default)]
    pub issues: Vec<HealthIssue>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerCounts {
    pub people: u32,
    pub suspended_people: u32,
    pub devices: u32,
    pub projects: u32,
    pub archived_projects: u32,
    pub pending_projects: u32,
    pub open_rooms: u32,
    pub people_online: u32,
    #[serde(default)]
    pub pending_guest_approvals: u32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilesLocation {
    Disk,
    S3,
    #[serde(other)]
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct StorageUsage {
    pub database_bytes: u64,
    pub snapshot_bytes: u64,
    pub file_bytes: u64,
    pub files_location: FilesLocation,
}

// Sign-ins on one UTC day: how many, and how many different people.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DailyActivity {
    // Midnight UTC that starts the day, in milliseconds.
    pub day: i64,
    pub sign_ins: u32,
    pub people: u32,
}

// Sign-ins in one hour of one weekday, in UTC, over the whole range.
// Weekday 0 is Sunday.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct HourlyActivity {
    pub weekday: u8,
    pub hour: u8,
    pub sign_ins: u32,
}

// What the security log recorded over the last `days` UTC days, starting at
// `since`. Only days and hours with a sign-in are listed; the rest had none.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ServerActivity {
    pub since: i64,
    pub days: u32,
    #[serde(default)]
    pub daily: Vec<DailyActivity>,
    #[serde(default)]
    pub by_hour: Vec<HourlyActivity>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminOverview {
    pub server_name: String,
    pub version: String,
    pub protocol: ProtocolRange,
    pub started_at: i64,
    pub now: i64,
    pub health: ServerHealth,
    pub counts: ServerCounts,
    #[serde(default)]
    pub storage: Option<StorageUsage>,
    pub email_configured: bool,
    pub providers: Vec<ProviderInfo>,
    pub settings: RuntimeSettings,
    pub limits: Limits,
    #[serde(default)]
    pub archive_days: u32,
    #[serde(default)]
    pub sign_in_problems: Vec<SignInProblem>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub comments_changed_while_off: Vec<CommentChangeWhileOff>,
    // Left out by servers older than the activity charts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activity: Option<ServerActivity>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AdminProjectSort {
    Title,
    Owner,
    Members,
    Size,
    Activity,
    Created,
}

impl AdminProjectSort {
    pub fn as_str(self) -> &'static str {
        match self {
            AdminProjectSort::Title => "title",
            AdminProjectSort::Owner => "owner",
            AdminProjectSort::Members => "members",
            AdminProjectSort::Size => "size",
            AdminProjectSort::Activity => "activity",
            AdminProjectSort::Created => "created",
        }
    }

    pub fn parse(text: &str) -> Option<AdminProjectSort> {
        [
            AdminProjectSort::Title,
            AdminProjectSort::Owner,
            AdminProjectSort::Members,
            AdminProjectSort::Size,
            AdminProjectSort::Activity,
            AdminProjectSort::Created,
        ]
        .into_iter()
        .find(|sort| sort.as_str() == text)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SortOrder {
    Asc,
    Desc,
}

impl SortOrder {
    pub fn as_str(self) -> &'static str {
        match self {
            SortOrder::Asc => "asc",
            SortOrder::Desc => "desc",
        }
    }

    pub fn parse(text: &str) -> Option<SortOrder> {
        match text {
            "asc" => Some(SortOrder::Asc),
            "desc" => Some(SortOrder::Desc),
            _ => None,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminProjectsQuery {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub q: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<ProjectStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<AdminProjectSort>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub order: Option<SortOrder>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminProject {
    pub project_id: SharedProjectId,
    pub title: String,
    pub owner: PersonSummary,
    pub status: ProjectStatus,
    pub member_count: u32,
    #[serde(default)]
    pub size_bytes: Option<u64>,
    pub created_at: i64,
    pub last_activity_at: i64,
    #[serde(default)]
    pub archived_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdminProjectsPage {
    pub items: Vec<AdminProject>,
    pub next_cursor: Option<String>,
    pub total: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const PROJECT: &str = "01920000-0000-7000-8000-0000000000aa";
    const ACCOUNT: &str = "01920000-0000-7000-8000-000000000002";

    #[test]
    fn an_overview_round_trips_and_tolerates_a_newer_server() {
        let wire = json!({
            "server_name": "Smith Lab",
            "version": "0.1.0",
            "protocol": { "min": 1, "max": 1 },
            "started_at": 10,
            "now": 70,
            "health": { "status": "warning", "issues": ["no_sign_in_provider", "storage_not_writable", "sign_in_failing", "sign_in_emails_paused"] },
            "counts": {
                "people": 3,
                "suspended_people": 1,
                "devices": 4,
                "projects": 2,
                "archived_projects": 1,
                "pending_projects": 0,
                "open_rooms": 1,
                "people_online": 2,
                "pending_guest_approvals": 3
            },
            "storage": {
                "database_bytes": 4096,
                "snapshot_bytes": 100,
                "file_bytes": 50,
                "files_location": "s3"
            },
            "email_configured": true,
            "providers": [{ "id": "github", "kind": "github", "label": "GitHub" }],
            "settings": RuntimeSettings::default(),
            "limits": { "max_project_mb": 200, "max_file_mb": 50, "max_members_per_project": 20 },
            "archive_days": 30,
            "sign_in_problems": [{
                "provider": "uni",
                "at": 60,
                "reason": "unauthorized_client: The client is not allowed to request this grant."
            }]
        });
        let overview: AdminOverview = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(overview.counts.pending_guest_approvals, 3);
        assert_eq!(overview.health.issues[2], HealthIssue::SignInFailing);
        assert_eq!(overview.health.issues[3], HealthIssue::SignInEmailsPaused);
        assert_eq!(overview.sign_in_problems[0].provider, "uni");
        assert_eq!(overview.health.status, HealthStatus::Warning);
        assert_eq!(overview.storage.unwrap().files_location, FilesLocation::S3);
        assert_eq!(serde_json::to_value(&overview).unwrap(), wire);

        let mut later = wire;
        later["health"] = json!({ "status": "on_fire", "issues": ["disk_full"] });
        later.as_object_mut().unwrap().remove("storage");
        let parsed: AdminOverview = serde_json::from_value(later).unwrap();
        assert_eq!(parsed.health.status, HealthStatus::Unknown);
        assert_eq!(parsed.health.issues, vec![HealthIssue::Unknown]);
        assert_eq!(parsed.storage, None);
        let mut older = serde_json::to_value(&parsed).unwrap();
        older.as_object_mut().unwrap().remove("archive_days");
        older.as_object_mut().unwrap().remove("sign_in_problems");
        older["counts"]
            .as_object_mut()
            .unwrap()
            .remove("pending_guest_approvals");
        let without: AdminOverview = serde_json::from_value(older).unwrap();
        assert_eq!(without.archive_days, 0);
        assert!(without.sign_in_problems.is_empty());
        assert_eq!(without.counts.pending_guest_approvals, 0);
        let tape: FilesLocation = serde_json::from_value(json!("tape")).unwrap();
        assert_eq!(tape, FilesLocation::Unknown);
    }

    #[test]
    fn an_overview_carries_activity_and_an_older_server_leaves_it_out() {
        let activity = json!({
            "since": 1_757_376_000_000_i64,
            "days": 30,
            "daily": [{ "day": 1_759_881_600_000_i64, "sign_ins": 3, "people": 2 }],
            "by_hour": [{ "weekday": 4, "hour": 9, "sign_ins": 3 }]
        });
        let wire = json!({
            "server_name": "Smith Lab",
            "version": "0.1.0",
            "protocol": { "min": 1, "max": 1 },
            "started_at": 10,
            "now": 70,
            "health": { "status": "ok", "issues": [] },
            "counts": ServerCounts::default(),
            "storage": null,
            "email_configured": false,
            "providers": [],
            "settings": RuntimeSettings::default(),
            "limits": { "max_project_mb": 200, "max_file_mb": 50, "max_members_per_project": 20 },
            "archive_days": 30,
            "sign_in_problems": [],
            "activity": activity
        });
        let overview: AdminOverview = serde_json::from_value(wire.clone()).unwrap();
        let parsed = overview.activity.clone().expect("the activity is read");
        assert_eq!(parsed.days, ACTIVITY_DAYS);
        assert_eq!(
            parsed.daily,
            vec![DailyActivity {
                day: 1_759_881_600_000,
                sign_ins: 3,
                people: 2
            }]
        );
        assert_eq!(
            parsed.by_hour,
            vec![HourlyActivity {
                weekday: 4,
                hour: 9,
                sign_ins: 3
            }]
        );
        assert_eq!(serde_json::to_value(&overview).unwrap(), wire);

        let mut older = wire;
        older.as_object_mut().unwrap().remove("activity");
        let without: AdminOverview = serde_json::from_value(older.clone()).unwrap();
        assert_eq!(without.activity, None);
        assert_eq!(serde_json::to_value(&without).unwrap(), older);

        let sparse: ServerActivity =
            serde_json::from_value(json!({ "since": 0, "days": 30 })).unwrap();
        assert!(sparse.daily.is_empty() && sparse.by_hour.is_empty());
    }

    #[test]
    fn a_projects_page_round_trips() {
        let wire = json!({
            "items": [{
                "project_id": PROJECT,
                "title": "Thesis",
                "owner": {
                    "account_id": ACCOUNT,
                    "display_name": "Alice Chen",
                    "avatar_url": null,
                    "email": null,
                    "login": "alice"
                },
                "status": "archived",
                "member_count": 3,
                "size_bytes": null,
                "created_at": 1,
                "last_activity_at": 5,
                "archived_at": 5
            }],
            "next_cursor": "50",
            "total": 51
        });
        let page: AdminProjectsPage = serde_json::from_value(wire.clone()).unwrap();
        assert_eq!(page.items[0].status, ProjectStatus::Archived);
        assert_eq!(page.items[0].size_bytes, None);
        assert_eq!(serde_json::to_value(page).unwrap(), wire);
    }

    #[test]
    fn sort_names_and_orders_parse_from_their_wire_names() {
        for sort in [
            AdminProjectSort::Title,
            AdminProjectSort::Owner,
            AdminProjectSort::Members,
            AdminProjectSort::Size,
            AdminProjectSort::Activity,
            AdminProjectSort::Created,
        ] {
            assert_eq!(AdminProjectSort::parse(sort.as_str()), Some(sort));
            assert_eq!(serde_json::to_value(sort).unwrap(), json!(sort.as_str()));
        }
        assert_eq!(AdminProjectSort::parse("colour"), None);
        for order in [SortOrder::Asc, SortOrder::Desc] {
            assert_eq!(SortOrder::parse(order.as_str()), Some(order));
            assert_eq!(serde_json::to_value(order).unwrap(), json!(order.as_str()));
        }
        assert_eq!(SortOrder::parse("up"), None);
    }

    #[test]
    fn a_query_from_the_app_reads_nulls_as_unset() {
        let query: AdminProjectsQuery = serde_json::from_value(json!({
            "q": null,
            "status": "archived",
            "sort": "activity",
            "order": "desc",
            "cursor": null,
            "limit": 50
        }))
        .unwrap();
        assert_eq!(
            query,
            AdminProjectsQuery {
                q: None,
                status: Some(ProjectStatus::Archived),
                sort: Some(AdminProjectSort::Activity),
                order: Some(SortOrder::Desc),
                cursor: None,
                limit: Some(50),
            }
        );
    }

    #[test]
    fn an_empty_query_sends_nothing() {
        assert_eq!(
            serde_json::to_value(AdminProjectsQuery::default()).unwrap(),
            json!({})
        );
        let query = AdminProjectsQuery {
            q: Some("thesis".to_string()),
            status: Some(ProjectStatus::Active),
            sort: Some(AdminProjectSort::Size),
            order: Some(SortOrder::Desc),
            cursor: Some("50".to_string()),
            limit: Some(25),
        };
        assert_eq!(
            serde_json::to_value(&query).unwrap(),
            json!({
                "q": "thesis",
                "status": "active",
                "sort": "size",
                "order": "desc",
                "cursor": "50",
                "limit": 25
            })
        );
    }
}
