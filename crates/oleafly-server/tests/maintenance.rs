use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_server::clock::Clock;
use oleafly_server::security_log::{self, NewSecurityEvent};
use oleafly_server::state::{MaintenanceReport, DAY_MS};
use oleafly_server::test_support::test_app;
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
            expired_rows: 1
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
