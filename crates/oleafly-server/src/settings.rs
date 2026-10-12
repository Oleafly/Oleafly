use oleafly_collab_protocol::admin::{RuntimeSettings, RuntimeSettingsPatch};
use rusqlite::{params, Connection};
use serde_json::{json, Map, Value};

use crate::error::ServerError;

pub fn defaults() -> RuntimeSettings {
    RuntimeSettings {
        guests_enabled: false,
        guest_approval_required: true,
        directory_visible: true,
        directory_shows_email: true,
        link_sharing_allowed: true,
        access_logs_allowed: true,
        email_notifications: true,
        comments_allowed: true,
        email_link_sign_in: false,
    }
}

pub fn load(conn: &Connection) -> Result<RuntimeSettings, ServerError> {
    let mut settings = defaults();
    let mut statement = conn.prepare("SELECT key, value FROM settings")?;
    let rows = statement.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
    })?;
    for row in rows {
        let (key, value) = row?;
        set_field(&mut settings, &key, value != 0);
    }
    Ok(settings)
}

pub fn patch(
    conn: &Connection,
    patch: &RuntimeSettingsPatch,
) -> Result<RuntimeSettings, ServerError> {
    let changes = [
        ("guests_enabled", patch.guests_enabled),
        ("guest_approval_required", patch.guest_approval_required),
        ("directory_visible", patch.directory_visible),
        ("directory_shows_email", patch.directory_shows_email),
        ("link_sharing_allowed", patch.link_sharing_allowed),
        ("access_logs_allowed", patch.access_logs_allowed),
        ("email_notifications", patch.email_notifications),
        ("comments_allowed", patch.comments_allowed),
        ("email_link_sign_in", patch.email_link_sign_in),
    ];
    for (key, value) in changes {
        if let Some(value) = value {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                params![key, i64::from(value)],
            )?;
        }
    }
    load(conn)
}

pub fn differences(before: &RuntimeSettings, after: &RuntimeSettings) -> Map<String, Value> {
    pairs(before)
        .into_iter()
        .zip(pairs(after))
        .filter(|((_, old), (_, new))| old != new)
        .map(|((key, old), (_, new))| (key.to_string(), json!({"from": old, "to": new})))
        .collect()
}

fn pairs(settings: &RuntimeSettings) -> [(&'static str, bool); 9] {
    [
        ("guests_enabled", settings.guests_enabled),
        ("guest_approval_required", settings.guest_approval_required),
        ("directory_visible", settings.directory_visible),
        ("directory_shows_email", settings.directory_shows_email),
        ("link_sharing_allowed", settings.link_sharing_allowed),
        ("access_logs_allowed", settings.access_logs_allowed),
        ("email_notifications", settings.email_notifications),
        ("comments_allowed", settings.comments_allowed),
        ("email_link_sign_in", settings.email_link_sign_in),
    ]
}

fn set_field(settings: &mut RuntimeSettings, key: &str, value: bool) {
    match key {
        "guests_enabled" => settings.guests_enabled = value,
        "guest_approval_required" => settings.guest_approval_required = value,
        "directory_visible" => settings.directory_visible = value,
        "directory_shows_email" => settings.directory_shows_email = value,
        "link_sharing_allowed" => settings.link_sharing_allowed = value,
        "access_logs_allowed" => settings.access_logs_allowed = value,
        "email_notifications" => settings.email_notifications = value,
        "comments_allowed" => settings.comments_allowed = value,
        "email_link_sign_in" => settings.email_link_sign_in = value,
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    fn change(
        guests_enabled: Option<bool>,
        comments_allowed: Option<bool>,
    ) -> RuntimeSettingsPatch {
        RuntimeSettingsPatch {
            guests_enabled,
            guest_approval_required: None,
            directory_visible: None,
            directory_shows_email: None,
            link_sharing_allowed: None,
            access_logs_allowed: None,
            email_notifications: None,
            comments_allowed,
            email_link_sign_in: None,
        }
    }

    #[tokio::test]
    async fn email_link_sign_in_starts_off_and_an_admin_can_turn_it_on() {
        let (before, after, reloaded) = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let before = load(conn)?;
                let after = patch(
                    conn,
                    &RuntimeSettingsPatch {
                        email_link_sign_in: Some(true),
                        ..RuntimeSettingsPatch::default()
                    },
                )?;
                Ok((before, after, load(conn)?))
            })
            .await
            .unwrap();
        assert!(!before.email_link_sign_in);
        assert!(after.email_link_sign_in);
        assert!(reloaded.email_link_sign_in);
        assert_eq!(
            serde_json::Value::Object(differences(&before, &after)),
            serde_json::json!({"email_link_sign_in": {"from": false, "to": true}})
        );
    }

    #[tokio::test]
    async fn an_empty_table_loads_the_documented_defaults() {
        let loaded = Db::open_in_memory()
            .unwrap()
            .call(|conn| load(conn))
            .await
            .unwrap();
        assert!(!loaded.guests_enabled);
        assert!(loaded.guest_approval_required);
        assert!(loaded.directory_visible);
        assert!(loaded.directory_shows_email);
        assert!(loaded.link_sharing_allowed);
        assert!(loaded.access_logs_allowed);
        assert!(loaded.email_notifications);
        assert!(loaded.comments_allowed);
    }

    #[tokio::test]
    async fn stored_values_override_defaults_and_unknown_keys_are_ignored() {
        let loaded = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                conn.execute_batch(
                    "INSERT INTO settings (key, value) VALUES ('guests_enabled', 1), ('comments_allowed', 0), ('retired_setting', 1);",
                )?;
                load(conn)
            })
            .await
            .unwrap();
        assert!(loaded.guests_enabled);
        assert!(!loaded.comments_allowed);
        assert!(loaded.link_sharing_allowed);
    }

    #[tokio::test]
    async fn patches_change_only_the_named_settings_and_persist() {
        let (patched, reloaded, untouched) = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let patched = patch(conn, &change(Some(true), Some(false)))?;
                let reloaded = load(conn)?;
                let untouched = patch(conn, &change(None, None))?;
                Ok((patched, reloaded, untouched))
            })
            .await
            .unwrap();
        for settings in [&patched, &reloaded, &untouched] {
            assert!(settings.guests_enabled);
            assert!(!settings.comments_allowed);
            assert!(settings.guest_approval_required);
            assert!(settings.link_sharing_allowed);
        }
    }

    #[test]
    fn differences_list_each_changed_setting() {
        let before = defaults();
        let mut after = defaults();
        after.guests_enabled = true;
        after.link_sharing_allowed = false;
        assert_eq!(
            serde_json::Value::Object(differences(&before, &after)),
            serde_json::json!({
                "guests_enabled": {"from": false, "to": true},
                "link_sharing_allowed": {"from": true, "to": false}
            })
        );
        assert!(differences(&before, &before).is_empty());
    }
}
