use rusqlite::Connection;

use crate::db;
use crate::error::ServerError;
use crate::members;

pub fn matches(conn: &Connection, presented_hash: &str) -> Result<bool, ServerError> {
    if members::count_admins(conn)? > 0 {
        return Ok(false);
    }
    Ok(db::meta_get(conn, db::SETUP_CODE_HASH_KEY)?.as_deref() == Some(presented_hash))
}

pub fn consume(conn: &Connection) -> Result<(), ServerError> {
    db::meta_delete(conn, db::SETUP_CODE_HASH_KEY)
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::state::setup_code_hash;
    use crate::test_support::{seed_member, test_app, TEST_SETUP_CODE};

    #[tokio::test]
    async fn the_preset_code_matches_until_consumed() {
        let app = test_app().await;
        let (right, normalized, wrong, after) = app
            .state
            .db
            .call(|conn| {
                let right = matches(conn, &setup_code_hash(TEST_SETUP_CODE))?;
                let normalized = matches(conn, &setup_code_hash(&TEST_SETUP_CODE.to_lowercase()))?;
                let wrong = matches(conn, &setup_code_hash("WRONG-CODE"))?;
                consume(conn)?;
                let after = matches(conn, &setup_code_hash(TEST_SETUP_CODE))?;
                Ok((right, normalized, wrong, after))
            })
            .await
            .expect("db");
        assert!(right);
        assert!(normalized);
        assert!(!wrong);
        assert!(!after);
    }

    #[tokio::test]
    async fn the_code_stops_matching_once_an_active_admin_exists() {
        let app = test_app().await;
        seed_member(&app, ServerRole::Admin).await;
        let matched = app
            .state
            .db
            .call(|conn| matches(conn, &setup_code_hash(TEST_SETUP_CODE)))
            .await
            .expect("db");
        assert!(!matched);
    }
}
