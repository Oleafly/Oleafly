use oleafly_collab_protocol::auth::ChallengeResponse;
use rusqlite::{params, Connection};

use crate::auth::db_error;
use crate::error::ServerError;
use crate::tokens::random_token;

pub const NONCE_TTL_MS: i64 = 120_000;

pub fn issue(conn: &Connection, now: i64) -> Result<ChallengeResponse, ServerError> {
    conn.execute("DELETE FROM nonces WHERE expires_at <= ?1", params![now])
        .map_err(db_error)?;
    let nonce = random_token();
    let expires_at = now + NONCE_TTL_MS;
    conn.execute(
        "INSERT INTO nonces (nonce, expires_at) VALUES (?1, ?2)",
        params![nonce, expires_at],
    )
    .map_err(db_error)?;
    Ok(ChallengeResponse { nonce, expires_at })
}

pub fn consume(conn: &Connection, nonce: &str, now: i64) -> Result<bool, ServerError> {
    let removed = conn
        .execute(
            "DELETE FROM nonces WHERE nonce = ?1 AND expires_at > ?2",
            params![nonce, now],
        )
        .map_err(db_error)?;
    Ok(removed == 1)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_app;

    #[tokio::test]
    async fn a_nonce_is_used_once_and_expires() {
        let app = test_app().await;
        let (expires_at, first, second, late) = app
            .state
            .db
            .call(|conn| {
                let issued = issue(conn, 1_000)?;
                let first = consume(conn, &issued.nonce, 1_500)?;
                let second = consume(conn, &issued.nonce, 1_600)?;
                let other = issue(conn, 1_000)?;
                let late = consume(conn, &other.nonce, 1_000 + NONCE_TTL_MS)?;
                Ok((issued.expires_at, first, second, late))
            })
            .await
            .expect("db");
        assert_eq!(expires_at, 1_000 + NONCE_TTL_MS);
        assert!(first);
        assert!(!second);
        assert!(!late);
    }
}
