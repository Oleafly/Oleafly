use oleafly_collab_protocol::admin::{Page, SecurityEvent, SecurityEventKind};
use oleafly_collab_protocol::ids::AccountId;
use rusqlite::{params, Connection};

use crate::db::parse_id;
use crate::error::ServerError;

pub const DEFAULT_PAGE_SIZE: u32 = 50;
pub const MAX_PAGE_SIZE: u32 = 200;

pub struct NewSecurityEvent {
    pub actor: Option<AccountId>,
    pub kind: SecurityEventKind,
    pub target: Option<String>,
    pub ip: Option<String>,
    pub detail: serde_json::Value,
}

pub fn kind_to_str(kind: &SecurityEventKind) -> &'static str {
    match kind {
        SecurityEventKind::SetupCompleted => "setup_completed",
        SecurityEventKind::SignIn => "sign_in",
        SecurityEventKind::SignInRefused => "sign_in_refused",
        SecurityEventKind::DeviceAdded => "device_added",
        SecurityEventKind::DeviceSignedOut => "device_signed_out",
        SecurityEventKind::RefreshReuseDetected => "refresh_reuse_detected",
        SecurityEventKind::MemberAdded => "member_added",
        SecurityEventKind::MemberRemoved => "member_removed",
        SecurityEventKind::MemberSuspended => "member_suspended",
        SecurityEventKind::MemberReactivated => "member_reactivated",
        SecurityEventKind::RoleChanged => "role_changed",
        SecurityEventKind::AllowlistAdded => "allowlist_added",
        SecurityEventKind::AllowlistRemoved => "allowlist_removed",
        SecurityEventKind::DomainRuleAdded => "domain_rule_added",
        SecurityEventKind::DomainRuleRemoved => "domain_rule_removed",
        SecurityEventKind::SettingsChanged => "settings_changed",
        SecurityEventKind::ProjectShared => "project_shared",
        SecurityEventKind::ProjectAccessGranted => "project_access_granted",
        SecurityEventKind::ProjectAccessChanged => "project_access_changed",
        SecurityEventKind::ProjectAccessRemoved => "project_access_removed",
        SecurityEventKind::ProjectArchived => "project_archived",
        SecurityEventKind::ProjectUnarchived => "project_unarchived",
        SecurityEventKind::ProjectSettingsChanged => "project_settings_changed",
        SecurityEventKind::GuestInvited => "guest_invited",
        SecurityEventKind::GuestInvitationApproved => "guest_invitation_approved",
        SecurityEventKind::GuestInvitationDeclined => "guest_invitation_declined",
        SecurityEventKind::GuestInvitationRevoked => "guest_invitation_revoked",
        SecurityEventKind::GuestAdmissionEnded => "guest_admission_ended",
        SecurityEventKind::ProjectRejoinRefused => "project_rejoin_refused",
        SecurityEventKind::Unknown => "unknown",
    }
}

pub fn kind_from_str(text: &str) -> Option<SecurityEventKind> {
    match text {
        "setup_completed" => Some(SecurityEventKind::SetupCompleted),
        "sign_in" => Some(SecurityEventKind::SignIn),
        "sign_in_refused" => Some(SecurityEventKind::SignInRefused),
        "device_added" => Some(SecurityEventKind::DeviceAdded),
        "device_signed_out" => Some(SecurityEventKind::DeviceSignedOut),
        "refresh_reuse_detected" => Some(SecurityEventKind::RefreshReuseDetected),
        "member_added" => Some(SecurityEventKind::MemberAdded),
        "member_removed" => Some(SecurityEventKind::MemberRemoved),
        "member_suspended" => Some(SecurityEventKind::MemberSuspended),
        "member_reactivated" => Some(SecurityEventKind::MemberReactivated),
        "role_changed" => Some(SecurityEventKind::RoleChanged),
        "allowlist_added" => Some(SecurityEventKind::AllowlistAdded),
        "allowlist_removed" => Some(SecurityEventKind::AllowlistRemoved),
        "domain_rule_added" => Some(SecurityEventKind::DomainRuleAdded),
        "domain_rule_removed" => Some(SecurityEventKind::DomainRuleRemoved),
        "settings_changed" => Some(SecurityEventKind::SettingsChanged),
        "project_shared" => Some(SecurityEventKind::ProjectShared),
        "project_access_granted" => Some(SecurityEventKind::ProjectAccessGranted),
        "project_access_changed" => Some(SecurityEventKind::ProjectAccessChanged),
        "project_access_removed" => Some(SecurityEventKind::ProjectAccessRemoved),
        "project_archived" => Some(SecurityEventKind::ProjectArchived),
        "project_unarchived" => Some(SecurityEventKind::ProjectUnarchived),
        "project_settings_changed" => Some(SecurityEventKind::ProjectSettingsChanged),
        "guest_invited" => Some(SecurityEventKind::GuestInvited),
        "guest_invitation_approved" => Some(SecurityEventKind::GuestInvitationApproved),
        "guest_invitation_declined" => Some(SecurityEventKind::GuestInvitationDeclined),
        "guest_invitation_revoked" => Some(SecurityEventKind::GuestInvitationRevoked),
        "guest_admission_ended" => Some(SecurityEventKind::GuestAdmissionEnded),
        "project_rejoin_refused" => Some(SecurityEventKind::ProjectRejoinRefused),
        _ => None,
    }
}

pub fn record(conn: &Connection, now: i64, event: NewSecurityEvent) -> Result<i64, ServerError> {
    let detail = serde_json::to_string(&event.detail).map_err(|error| {
        ServerError::Internal(format!("could not encode a security event: {error}"))
    })?;
    conn.execute(
        "INSERT INTO security_log (at, actor, kind, target, ip, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            now,
            event.actor.map(|actor| actor.to_string()),
            kind_to_str(&event.kind),
            event.target,
            event.ip,
            detail
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

struct RawEvent {
    id: i64,
    at: i64,
    actor: Option<String>,
    kind: String,
    target: Option<String>,
    ip: Option<String>,
    detail: String,
    project_title: Option<String>,
    device_name: Option<String>,
}

pub fn page(
    conn: &Connection,
    cursor: Option<&str>,
    limit: u32,
) -> Result<Page<SecurityEvent>, ServerError> {
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let before = match cursor {
        None => i64::MAX,
        Some(text) => text
            .parse::<i64>()
            .ok()
            .filter(|id| *id > 0)
            .ok_or_else(|| {
                ServerError::BadRequest("That security log cursor is not valid.".to_string())
            })?,
    };
    let mut statement = conn.prepare(
        "SELECT s.id, s.at, s.actor, s.kind, s.target, s.ip, s.detail, p.title, d.name FROM security_log s \
         LEFT JOIN projects p ON p.id = COALESCE(\
         CASE WHEN json_valid(s.detail) THEN json_extract(s.detail, '$.project') END, s.target) \
         LEFT JOIN devices d ON d.id = s.target \
         AND s.kind IN ('device_added', 'device_signed_out', 'refresh_reuse_detected') \
         WHERE s.id < ?1 ORDER BY s.id DESC LIMIT ?2",
    )?;
    let rows = statement
        .query_map(params![before, i64::from(limit) + 1], |row| {
            Ok(RawEvent {
                id: row.get(0)?,
                at: row.get(1)?,
                actor: row.get(2)?,
                kind: row.get(3)?,
                target: row.get(4)?,
                ip: row.get(5)?,
                detail: row.get(6)?,
                project_title: row.get(7)?,
                device_name: row.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let wanted = usize::try_from(limit).unwrap_or(usize::MAX);
    let has_more = rows.len() > wanted;
    let mut items = Vec::with_capacity(wanted.min(rows.len()));
    for raw in rows.into_iter().take(wanted) {
        items.push(event_from_raw(raw)?);
    }
    let next_cursor = if has_more {
        items.last().map(|item| item.id.to_string())
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

fn event_from_raw(raw: RawEvent) -> Result<SecurityEvent, ServerError> {
    let kind = kind_from_str(&raw.kind).unwrap_or(SecurityEventKind::Unknown);
    Ok(SecurityEvent {
        id: raw.id,
        at: raw.at,
        actor: raw.actor.as_deref().map(parse_id).transpose()?,
        kind,
        target: raw.target,
        ip: raw.ip,
        detail: serde_json::from_str(&raw.detail).unwrap_or(serde_json::Value::Null),
        project_title: raw.project_title,
        device_name: raw.device_name,
    })
}

pub fn prune(conn: &Connection, older_than: i64) -> Result<usize, ServerError> {
    Ok(conn.execute("DELETE FROM security_log WHERE at < ?1", [older_than])?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;
    use oleafly_collab_protocol::ids::SharedProjectId;
    use serde_json::json;

    const ALL_KINDS: [SecurityEventKind; 29] = [
        SecurityEventKind::SetupCompleted,
        SecurityEventKind::SignIn,
        SecurityEventKind::SignInRefused,
        SecurityEventKind::DeviceAdded,
        SecurityEventKind::DeviceSignedOut,
        SecurityEventKind::RefreshReuseDetected,
        SecurityEventKind::MemberAdded,
        SecurityEventKind::MemberRemoved,
        SecurityEventKind::MemberSuspended,
        SecurityEventKind::MemberReactivated,
        SecurityEventKind::RoleChanged,
        SecurityEventKind::AllowlistAdded,
        SecurityEventKind::AllowlistRemoved,
        SecurityEventKind::DomainRuleAdded,
        SecurityEventKind::DomainRuleRemoved,
        SecurityEventKind::SettingsChanged,
        SecurityEventKind::ProjectShared,
        SecurityEventKind::ProjectAccessGranted,
        SecurityEventKind::ProjectAccessChanged,
        SecurityEventKind::ProjectAccessRemoved,
        SecurityEventKind::ProjectArchived,
        SecurityEventKind::ProjectUnarchived,
        SecurityEventKind::ProjectSettingsChanged,
        SecurityEventKind::GuestInvited,
        SecurityEventKind::GuestInvitationApproved,
        SecurityEventKind::GuestInvitationDeclined,
        SecurityEventKind::GuestInvitationRevoked,
        SecurityEventKind::GuestAdmissionEnded,
        SecurityEventKind::ProjectRejoinRefused,
    ];

    fn event(target: &str) -> NewSecurityEvent {
        NewSecurityEvent {
            actor: None,
            kind: SecurityEventKind::SignIn,
            target: Some(target.to_string()),
            ip: None,
            detail: json!({}),
        }
    }

    fn targets(listed: &Page<SecurityEvent>) -> Vec<&str> {
        listed
            .items
            .iter()
            .filter_map(|item| item.target.as_deref())
            .collect()
    }

    #[test]
    fn every_kind_round_trips_through_its_stored_name() {
        let names: Vec<&str> = ALL_KINDS.iter().map(kind_to_str).collect();
        assert_eq!(
            names,
            [
                "setup_completed",
                "sign_in",
                "sign_in_refused",
                "device_added",
                "device_signed_out",
                "refresh_reuse_detected",
                "member_added",
                "member_removed",
                "member_suspended",
                "member_reactivated",
                "role_changed",
                "allowlist_added",
                "allowlist_removed",
                "domain_rule_added",
                "domain_rule_removed",
                "settings_changed",
                "project_shared",
                "project_access_granted",
                "project_access_changed",
                "project_access_removed",
                "project_archived",
                "project_unarchived",
                "project_settings_changed",
                "guest_invited",
                "guest_invitation_approved",
                "guest_invitation_declined",
                "guest_invitation_revoked",
                "guest_admission_ended",
                "project_rejoin_refused",
            ]
        );
        for name in &names {
            let kind = kind_from_str(name).expect("a known kind");
            assert_eq!(kind_to_str(&kind), *name);
        }
        assert!(kind_from_str("kind_from_a_later_server").is_none());
        assert_eq!(kind_to_str(&SecurityEventKind::Unknown), "unknown");
    }

    #[tokio::test]
    async fn device_events_carry_the_name_of_their_device() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let account = crate::members::create_account(
                    conn,
                    "Ada",
                    None,
                    oleafly_collab_protocol::roles::ServerRole::Member,
                    1,
                )?;
                let device = oleafly_collab_protocol::ids::DeviceId::new_v7();
                conn.execute(
                    "INSERT INTO devices (id, account_id, public_key, name, platform, created_at) VALUES (?1, ?2, 'key', 'Ada''s MacBook', 'macos', 1)",
                    params![device.to_string(), account.to_string()],
                )?;
                for kind in [
                    SecurityEventKind::DeviceAdded,
                    SecurityEventKind::DeviceSignedOut,
                    SecurityEventKind::RefreshReuseDetected,
                    SecurityEventKind::SignIn,
                ] {
                    record(
                        conn,
                        2,
                        NewSecurityEvent {
                            actor: Some(account),
                            kind,
                            target: Some(device.to_string()),
                            ip: None,
                            detail: json!({}),
                        },
                    )?;
                }
                let names: Vec<Option<String>> = page(conn, None, 10)?
                    .items
                    .into_iter()
                    .map(|item| item.device_name)
                    .collect();
                let named = Some("Ada's MacBook".to_string());
                assert_eq!(names, [None, named.clone(), named.clone(), named]);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn a_kind_this_server_does_not_know_reads_as_unknown() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                conn.execute(
                    "INSERT INTO security_log (at, actor, kind, target, ip, detail) VALUES (1, NULL, 'kind_from_a_later_server', NULL, NULL, '{}')",
                    [],
                )?;
                let listed = page(conn, None, 10)?;
                assert_eq!(listed.items.len(), 1);
                assert_eq!(listed.items[0].kind, SecurityEventKind::Unknown);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn records_keep_every_field() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let actor = AccountId::new_v7();
                let id = record(
                    conn,
                    42,
                    NewSecurityEvent {
                        actor: Some(actor),
                        kind: SecurityEventKind::RoleChanged,
                        target: Some("target".to_string()),
                        ip: Some("203.0.113.5".to_string()),
                        detail: json!({"from": "member", "to": "maintainer"}),
                    },
                )?;
                let listed = page(conn, None, 10)?;
                let stored = &listed.items[0];
                assert_eq!(stored.id, id);
                assert_eq!(stored.at, 42);
                assert_eq!(stored.actor, Some(actor));
                assert_eq!(kind_to_str(&stored.kind), "role_changed");
                assert_eq!(stored.target.as_deref(), Some("target"));
                assert_eq!(stored.ip.as_deref(), Some("203.0.113.5"));
                assert_eq!(stored.detail, json!({"from": "member", "to": "maintainer"}));
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn pages_run_newest_first_and_end_without_a_cursor() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                for index in 1..=5 {
                    record(conn, index, event(&format!("e{index}")))?;
                }
                let first = page(conn, None, 2)?;
                assert_eq!(targets(&first), ["e5", "e4"]);
                let second = page(conn, first.next_cursor.as_deref(), 2)?;
                assert_eq!(targets(&second), ["e3", "e2"]);
                let third = page(conn, second.next_cursor.as_deref(), 2)?;
                assert_eq!(targets(&third), ["e1"]);
                assert_eq!(third.next_cursor, None);
                let exact = page(conn, None, 5)?;
                assert_eq!(exact.items.len(), 5);
                assert_eq!(exact.next_cursor, None);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn bad_cursors_are_bad_requests_and_limits_are_clamped() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                for cursor in ["abc", "0", "-3", ""] {
                    assert!(
                        matches!(
                            page(conn, Some(cursor), 10),
                            Err(ServerError::BadRequest(_))
                        ),
                        "{cursor}"
                    );
                }
                for index in 0..250 {
                    record(conn, index, event("bulk"))?;
                }
                assert_eq!(page(conn, None, 0)?.items.len(), 1);
                assert_eq!(page(conn, None, 1_000)?.items.len(), 200);
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn pages_name_the_project_an_event_is_about() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let owner = AccountId::new_v7();
                conn.execute(
                    "INSERT INTO accounts (id, display_name, avatar_url, server_role, status, created_at, updated_at) VALUES (?1, 'Owner', NULL, 'member', 'active', 1, 1)",
                    [owner.to_string()],
                )?;
                let project = crate::projects::create_pending(conn, owner, "Thesis draft", 1)?;
                let gone = SharedProjectId::new_v7();
                let about = |target: String, detail: serde_json::Value| NewSecurityEvent {
                    actor: Some(owner),
                    kind: SecurityEventKind::ProjectAccessGranted,
                    target: Some(target),
                    ip: None,
                    detail,
                };
                record(conn, 1, about(project.to_string(), json!({ "via": "link" })))?;
                record(
                    conn,
                    2,
                    about(owner.to_string(), json!({ "project": project.to_string() })),
                )?;
                record(conn, 3, about(gone.to_string(), json!({})))?;
                record(conn, 4, about(owner.to_string(), json!({})))?;
                conn.execute(
                    "INSERT INTO security_log (at, actor, kind, target, ip, detail) VALUES (5, NULL, 'sign_in', ?1, NULL, 'not json')",
                    [project.to_string()],
                )?;
                let listed = page(conn, None, 10)?;
                let titles: Vec<Option<&str>> = listed
                    .items
                    .iter()
                    .map(|item| item.project_title.as_deref())
                    .collect();
                assert_eq!(
                    titles,
                    [
                        Some("Thesis draft"),
                        None,
                        None,
                        Some("Thesis draft"),
                        Some("Thesis draft"),
                    ]
                );
                Ok(())
            })
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn prune_removes_only_older_events() {
        Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                for (at, target) in [(10, "old"), (20, "edge"), (30, "new")] {
                    record(conn, at, event(target))?;
                }
                assert_eq!(prune(conn, 20)?, 1);
                assert_eq!(targets(&page(conn, None, 10)?), ["new", "edge"]);
                Ok(())
            })
            .await
            .unwrap();
    }
}
