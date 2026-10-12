use oleafly_collab_protocol::ids::AccountId;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ServerError;

pub fn shared_with_you(conn: &Connection, account: AccountId) -> Result<bool, ServerError> {
    let stored: Option<i64> = conn
        .query_row(
            "SELECT shared_with_you FROM email_preferences WHERE account_id = ?1",
            [account.to_string()],
            |row| row.get(0),
        )
        .optional()?;
    Ok(stored.is_none_or(|value| value != 0))
}

pub fn set_shared_with_you(
    conn: &Connection,
    account: AccountId,
    enabled: bool,
    now: i64,
) -> Result<(), ServerError> {
    conn.execute(
        "INSERT INTO email_preferences (account_id, shared_with_you, updated_at) VALUES (?1, ?2, ?3) \
         ON CONFLICT (account_id) DO UPDATE SET shared_with_you = excluded.shared_with_you, updated_at = excluded.updated_at",
        params![account.to_string(), i64::from(enabled), now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use oleafly_collab_protocol::roles::ServerRole;

    use super::*;
    use crate::db::Db;
    use crate::members;

    #[tokio::test]
    async fn share_emails_are_on_until_a_person_turns_them_off() {
        let (before, off, on_again, other) = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let ada = members::create_account(conn, "Ada", None, ServerRole::Member, 1)?;
                let bob = members::create_account(conn, "Bob", None, ServerRole::Member, 1)?;
                let before = shared_with_you(conn, ada)?;
                set_shared_with_you(conn, ada, false, 2)?;
                let off = shared_with_you(conn, ada)?;
                set_shared_with_you(conn, ada, true, 3)?;
                let on_again = shared_with_you(conn, ada)?;
                set_shared_with_you(conn, bob, false, 4)?;
                Ok((before, off, on_again, shared_with_you(conn, bob)?))
            })
            .await
            .unwrap();
        assert!(before);
        assert!(!off);
        assert!(on_again);
        assert!(!other);
    }
}
