use rusqlite::{params, Connection, OptionalExtension};

use crate::error::ServerError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Throttle {
    Allowed,
    LockedOut { first: bool },
}

fn current(conn: &Connection, key: &str, now: i64) -> Result<Option<(i64, bool)>, ServerError> {
    conn.execute(
        "DELETE FROM sign_in_throttle WHERE expires_at <= ?1",
        params![now],
    )?;
    Ok(conn
        .query_row(
            "SELECT hits, lockout_logged FROM sign_in_throttle WHERE key = ?1",
            params![key],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)? != 0)),
        )
        .optional()?)
}

fn locked_out(conn: &Connection, key: &str, logged: bool) -> Result<Throttle, ServerError> {
    if !logged {
        conn.execute(
            "UPDATE sign_in_throttle SET lockout_logged = 1 WHERE key = ?1",
            params![key],
        )?;
    }
    Ok(Throttle::LockedOut { first: !logged })
}

pub fn hit(
    conn: &Connection,
    key: &str,
    limit: u32,
    window_ms: i64,
    now: i64,
) -> Result<Throttle, ServerError> {
    match current(conn, key, now)? {
        None => {
            conn.execute(
                "INSERT INTO sign_in_throttle (key, hits, lockout_logged, expires_at) VALUES (?1, 1, 0, ?2)",
                params![key, now + window_ms],
            )?;
            Ok(Throttle::Allowed)
        }
        Some((hits, logged)) if hits >= i64::from(limit) => locked_out(conn, key, logged),
        Some(_) => {
            conn.execute(
                "UPDATE sign_in_throttle SET hits = hits + 1 WHERE key = ?1",
                params![key],
            )?;
            Ok(Throttle::Allowed)
        }
    }
}

pub fn check(conn: &Connection, key: &str, limit: u32, now: i64) -> Result<Throttle, ServerError> {
    match current(conn, key, now)? {
        Some((hits, logged)) if hits >= i64::from(limit) => locked_out(conn, key, logged),
        _ => Ok(Throttle::Allowed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Db;

    const MINUTE: i64 = 60_000;

    #[tokio::test]
    async fn a_key_is_allowed_up_to_its_limit_then_locked_out_and_flagged_once() {
        let seen = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let mut seen = Vec::new();
                for _ in 0..5 {
                    seen.push(hit(conn, "email:ada@uni.edu", 3, 15 * MINUTE, 1_000)?);
                }
                Ok(seen)
            })
            .await
            .unwrap();
        assert_eq!(
            seen,
            [
                Throttle::Allowed,
                Throttle::Allowed,
                Throttle::Allowed,
                Throttle::LockedOut { first: true },
                Throttle::LockedOut { first: false },
            ]
        );
    }

    #[tokio::test]
    async fn the_window_ends_and_the_key_starts_over() {
        let (locked, later) = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                for _ in 0..2 {
                    hit(conn, "ip:10.0.0.1", 2, 10 * MINUTE, 0)?;
                }
                let locked = hit(conn, "ip:10.0.0.1", 2, 10 * MINUTE, 10 * MINUTE - 1)?;
                let later = hit(conn, "ip:10.0.0.1", 2, 10 * MINUTE, 10 * MINUTE)?;
                Ok((locked, later))
            })
            .await
            .unwrap();
        assert_eq!(locked, Throttle::LockedOut { first: true });
        assert_eq!(later, Throttle::Allowed);
    }

    #[tokio::test]
    async fn checking_counts_nothing_and_reports_a_lockout_once() {
        let seen = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                let fresh = check(conn, "code:10.0.0.1", 2, 0)?;
                hit(conn, "code:10.0.0.1", 2, MINUTE, 0)?;
                let below = check(conn, "code:10.0.0.1", 2, 1)?;
                hit(conn, "code:10.0.0.1", 2, MINUTE, 2)?;
                let first = check(conn, "code:10.0.0.1", 2, 3)?;
                let again = check(conn, "code:10.0.0.1", 2, 4)?;
                let over = check(conn, "code:10.0.0.1", 2, MINUTE)?;
                Ok(vec![fresh, below, first, again, over])
            })
            .await
            .unwrap();
        assert_eq!(
            seen,
            [
                Throttle::Allowed,
                Throttle::Allowed,
                Throttle::LockedOut { first: true },
                Throttle::LockedOut { first: false },
                Throttle::Allowed,
            ]
        );
    }

    #[tokio::test]
    async fn keys_are_counted_apart() {
        let (first, other) = Db::open_in_memory()
            .unwrap()
            .call(|conn| {
                hit(conn, "email:ada@uni.edu", 1, MINUTE, 0)?;
                let first = hit(conn, "email:ada@uni.edu", 1, MINUTE, 0)?;
                let other = hit(conn, "email:bob@uni.edu", 1, MINUTE, 0)?;
                Ok((first, other))
            })
            .await
            .unwrap();
        assert_eq!(first, Throttle::LockedOut { first: true });
        assert_eq!(other, Throttle::Allowed);
    }
}
