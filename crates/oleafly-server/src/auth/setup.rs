use oleafly_collab_protocol::crypto::sha256_b64url;
use rusqlite::{params, Connection};

use crate::db;
use crate::error::ServerError;
use crate::members;
use crate::tokens::random_token;

pub const CLAIM_TTL_MS: i64 = 10 * 60 * 1000;
const CLAIM_PREFIX: &str = "setup-claim.";

pub fn matches(conn: &Connection, presented_hash: &str) -> Result<bool, ServerError> {
    if members::count_admins(conn)? > 0 {
        return Ok(false);
    }
    Ok(db::meta_get(conn, db::SETUP_CODE_HASH_KEY)?.as_deref() == Some(presented_hash))
}

pub fn consume(conn: &Connection) -> Result<(), ServerError> {
    db::meta_delete(conn, db::SETUP_CODE_HASH_KEY)
}

fn claim_key(claim: &str, code_challenge: &str) -> String {
    let bound = format!("{claim}\0{code_challenge}");
    format!("{CLAIM_PREFIX}{}", sha256_b64url(bound.as_bytes()))
}

pub fn issue_claim(
    conn: &Connection,
    code_challenge: &str,
    now: i64,
) -> Result<String, ServerError> {
    conn.execute("DELETE FROM nonces WHERE expires_at <= ?1", params![now])?;
    let claim = random_token();
    conn.execute(
        "INSERT INTO nonces (nonce, expires_at) VALUES (?1, ?2)",
        params![claim_key(&claim, code_challenge), now + CLAIM_TTL_MS],
    )?;
    Ok(claim)
}

pub fn redeem_claim(
    conn: &Connection,
    claim: &str,
    code_challenge: &str,
    now: i64,
) -> Result<Option<String>, ServerError> {
    let removed = conn.execute(
        "DELETE FROM nonces WHERE nonce = ?1 AND expires_at > ?2",
        params![claim_key(claim, code_challenge), now],
    )?;
    if removed != 1 || members::count_admins(conn)? > 0 {
        return Ok(None);
    }
    db::meta_get(conn, db::SETUP_CODE_HASH_KEY)
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
    async fn a_claim_works_once_for_its_own_challenge_and_only_for_ten_minutes() {
        let app = test_app().await;
        let (other, own, again, late) = app
            .state
            .db
            .call(|conn| {
                let claim = issue_claim(conn, "challenge-a", 1_000)?;
                let other = redeem_claim(conn, &claim, "challenge-b", 2_000)?;
                let own = redeem_claim(conn, &claim, "challenge-a", 2_000)?;
                let again = redeem_claim(conn, &claim, "challenge-a", 2_000)?;
                let expiring = issue_claim(conn, "challenge-c", 1_000)?;
                let late = redeem_claim(conn, &expiring, "challenge-c", 1_000 + CLAIM_TTL_MS)?;
                Ok((other, own, again, late))
            })
            .await
            .expect("db");
        assert_eq!(other, None);
        assert_eq!(own, Some(setup_code_hash(TEST_SETUP_CODE)));
        assert_eq!(again, None);
        assert_eq!(late, None);
    }

    #[tokio::test]
    async fn a_claim_is_worth_nothing_once_an_admin_exists() {
        let app = test_app().await;
        let claim = app
            .state
            .db
            .call(|conn| issue_claim(conn, "challenge-a", 1_000))
            .await
            .expect("db");
        seed_member(&app, ServerRole::Admin).await;
        let redeemed = app
            .state
            .db
            .call(move |conn| redeem_claim(conn, &claim, "challenge-a", 2_000))
            .await
            .expect("db");
        assert_eq!(redeemed, None);
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
