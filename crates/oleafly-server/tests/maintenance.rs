use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::clock::Clock;
use oleafly_server::projects;
use oleafly_server::security_log::{self, NewSecurityEvent};
use oleafly_server::state::{MaintenanceReport, DAY_MS};
use oleafly_server::test_support::{seed_member, test_app};
use rusqlite::params;
use serde_json::json;

#[tokio::test]
async fn maintenance_prunes_old_security_events_and_expired_sign_in_rows() {
    let app = test_app().await;
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| {
            for (age_days, target) in [(400, "old"), (10, "recent")] {
                security_log::record(
                    conn,
                    now - age_days * DAY_MS,
                    NewSecurityEvent {
                        actor: None,
                        kind: SecurityEventKind::SignIn,
                        target: Some(target.to_string()),
                        ip: None,
                        detail: json!({}),
                    },
                )?;
            }
            conn.execute(
                "INSERT INTO nonces (nonce, expires_at) VALUES ('stale', ?1)",
                [now - 1],
            )?;
            conn.execute(
                "INSERT INTO nonces (nonce, expires_at) VALUES ('fresh', ?1)",
                [now + 120_000],
            )?;
            Ok(())
        })
        .await
        .unwrap();
    let report = app.state.run_maintenance().await.unwrap();
    assert_eq!(
        report,
        MaintenanceReport {
            security_events: 1,
            expired_rows: 1,
            expired_projects: 0,
            access_events: 0,
            guest_invitations: 0,
            web_sessions: 0,
        }
    );
    let (targets, nonces) = app
        .state
        .db
        .call(|conn| {
            let targets: Vec<String> = security_log::page(conn, None, 10)?
                .items
                .into_iter()
                .filter_map(|event| event.target)
                .collect();
            let mut statement = conn.prepare("SELECT nonce FROM nonces")?;
            let nonces = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok((targets, nonces))
        })
        .await
        .unwrap();
    assert_eq!(targets, ["recent"]);
    assert_eq!(nonces, ["fresh"]);
}

struct OldInvitation {
    id: &'static str,
    status: &'static str,
    created_days_ago: i64,
    expires_in_days: i64,
    decided_days_ago: Option<i64>,
    accepted_days_ago: Option<i64>,
}

fn invitation(id: &'static str, status: &'static str) -> OldInvitation {
    OldInvitation {
        id,
        status,
        created_days_ago: 1,
        expires_in_days: 13,
        decided_days_ago: None,
        accepted_days_ago: None,
    }
}

#[tokio::test]
async fn maintenance_removes_answered_and_expired_guest_invitations_after_the_log_retention() {
    let app = test_app().await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let now = app.clock.now_ms();
    let retention = i64::from(app.state.config.security_log_days);
    let past = retention + 35;
    let rows = vec![
        OldInvitation {
            decided_days_ago: Some(past),
            created_days_ago: past + 1,
            expires_in_days: -(past - 13),
            ..invitation("declined-long-ago", "declined")
        },
        OldInvitation {
            decided_days_ago: Some(10),
            created_days_ago: 11,
            expires_in_days: 3,
            ..invitation("declined-lately", "declined")
        },
        OldInvitation {
            decided_days_ago: Some(past),
            created_days_ago: past + 1,
            expires_in_days: -(past - 13),
            ..invitation("revoked-long-ago", "revoked")
        },
        OldInvitation {
            accepted_days_ago: Some(past),
            created_days_ago: past + 2,
            expires_in_days: -(past - 12),
            ..invitation("accepted-long-ago", "accepted")
        },
        OldInvitation {
            accepted_days_ago: Some(10),
            created_days_ago: past + 2,
            expires_in_days: -(past - 12),
            ..invitation("accepted-lately-after-a-long-wait", "accepted")
        },
        OldInvitation {
            created_days_ago: past + 14,
            expires_in_days: -past,
            ..invitation("expired-long-ago", "expired")
        },
        OldInvitation {
            created_days_ago: past + 14,
            expires_in_days: -past,
            ..invitation("lapsed-long-ago-without-being-marked", "invited")
        },
        OldInvitation {
            created_days_ago: 24,
            expires_in_days: -10,
            ..invitation("expired-lately", "expired")
        },
        invitation("still-open", "invited"),
        invitation("awaiting-approval", "awaiting_approval"),
    ];
    let account = owner.account_id;
    app.state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, account, "Thesis", now)?;
            for row in &rows {
                let days = |count: i64| now - count * DAY_MS;
                conn.execute(
                    "INSERT INTO guest_invitations (id, project_id, email, role, invited_by, status, created_at, expires_at, decided_by, decided_at, accepted_by, accepted_at) \
                     VALUES (?1, ?2, ?3, 'editor', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                    params![
                        row.id,
                        project.to_string(),
                        format!("{}@field.org", row.id),
                        account.to_string(),
                        row.status,
                        days(row.created_days_ago),
                        now + row.expires_in_days * DAY_MS,
                        row.decided_days_ago.map(|_| account.to_string()),
                        row.decided_days_ago.map(days),
                        row.accepted_days_ago.map(|_| account.to_string()),
                        row.accepted_days_ago.map(days),
                    ],
                )?;
            }
            Ok(())
        })
        .await
        .unwrap();
    let report = app.state.run_maintenance().await.unwrap();
    assert_eq!(report.guest_invitations, 5);
    let kept = app
        .state
        .db
        .call(|conn| {
            let mut statement = conn.prepare("SELECT id FROM guest_invitations ORDER BY id")?;
            let ids = statement
                .query_map([], |row| row.get::<_, String>(0))?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ids)
        })
        .await
        .unwrap();
    assert_eq!(
        kept,
        [
            "accepted-lately-after-a-long-wait",
            "awaiting-approval",
            "declined-lately",
            "expired-lately",
            "still-open",
        ]
    );
}
