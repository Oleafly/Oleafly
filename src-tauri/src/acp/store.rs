use super::preferences::{AgentPreferences, AgentRuntimeInfo, ProjectAgentSettings};
use super::types::{AcpEvent, AgentDefinition, EventPage, SessionRecord, SessionStatus};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{de::DeserializeOwned, Serialize};
use std::{path::Path, sync::Mutex};

const UNAVAILABLE: &str = "ACP storage is unavailable.";

pub struct Store {
    db: Mutex<Connection>,
}

/// A stored record with the counters kept in their own columns, so an event
/// append does not rewrite the record JSON.
fn decode(record: &str, updated_at: i64, last_sequence: i64) -> Result<SessionRecord, String> {
    let mut session: SessionRecord = serde_json::from_str(record).map_err(|e| e.to_string())?;
    session.updated_at = session
        .updated_at
        .max(u64::try_from(updated_at).unwrap_or(0));
    session.last_sequence = session
        .last_sequence
        .max(u64::try_from(last_sequence).unwrap_or(0));
    Ok(session)
}

fn signed(value: u64) -> i64 {
    i64::try_from(value).unwrap_or(i64::MAX)
}

/// `%`, `_` and `\` matched literally in a `LIKE ... ESCAPE '\'` pattern.
fn like_pattern(query: &str) -> String {
    let mut pattern = String::from("%");
    for c in query.chars() {
        if matches!(c, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    pattern.push('%');
    pattern
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let mut db = Connection::open(root.join("sessions.sqlite")).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS acp_sessions_project ON sessions(project_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL REFERENCES sessions(id), sequence INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(session_id,sequence));
            CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, definition TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_programs (id TEXT PRIMARY KEY, path TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS agent_preferences (agent_id TEXT PRIMARY KEY, prefs TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS project_agent_settings (project_id TEXT NOT NULL, agent_id TEXT NOT NULL, settings TEXT NOT NULL, PRIMARY KEY(project_id, agent_id));
            CREATE TABLE IF NOT EXISTS agent_runtime (agent_id TEXT PRIMARY KEY, info TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS session_counters (session_id TEXT PRIMARY KEY, last_sequence INTEGER NOT NULL);").map_err(|e| e.to_string())?;
        let has_sequence = {
            let mut statement = db
                .prepare("PRAGMA table_info(sessions)")
                .map_err(|e| e.to_string())?;
            let names = statement
                .query_map([], |row| row.get::<_, String>(1))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            names.iter().any(|name| name == "last_sequence")
        };
        // 0.4.7 writes four unnamed values into `sessions`, so the event
        // counter has a table of its own; a development build kept it in a
        // fifth column, which moves there.
        if has_sequence {
            let tx = db.transaction().map_err(|e| e.to_string())?;
            tx.execute(
                "INSERT OR REPLACE INTO session_counters (session_id, last_sequence)
                 SELECT id, last_sequence FROM sessions WHERE last_sequence > 0",
                [],
            )
            .map_err(|e| e.to_string())?;
            tx.execute("ALTER TABLE sessions DROP COLUMN last_sequence", [])
                .map_err(|e| e.to_string())?;
            tx.commit().map_err(|e| e.to_string())?;
        }
        // Conversations an older version deleted.
        db.execute(
            "DELETE FROM session_counters WHERE session_id NOT IN (SELECT id FROM sessions)",
            [],
        )
        .map_err(|e| e.to_string())?;
        let store = Self { db: Mutex::new(db) };
        let mut after = None;
        loop {
            let page = store.sessions_page(after.as_deref(), 500)?;
            if page.is_empty() {
                break;
            }
            after = page.last().map(|session| session.id.clone());
            for mut session in page {
                if matches!(
                    session.status,
                    SessionStatus::Running
                        | SessionStatus::Connecting
                        | SessionStatus::Ready
                        | SessionStatus::Cancelling
                        | SessionStatus::AuthRequired
                ) {
                    session.status = SessionStatus::Disconnected;
                    session.error = Some("The app closed before this session disconnected. You can read the saved conversation or reconnect.".into());
                    store.save(&session)?;
                }
            }
        }
        Ok(store)
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Connection>, String> {
        self.db.lock().map_err(|_| UNAVAILABLE.to_string())
    }

    pub fn save(&self, session: &SessionRecord) -> Result<(), String> {
        let record = serde_json::to_string(session).map_err(|e| e.to_string())?;
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO sessions (id, project_id, updated_at, record) VALUES (?1,?2,?3,?4)
             ON CONFLICT(id) DO UPDATE SET updated_at=MAX(sessions.updated_at, excluded.updated_at),
             record=excluded.record",
            params![
                session.id,
                session.project_id,
                signed(session.updated_at),
                record
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO session_counters (session_id, last_sequence) VALUES (?1,?2)
             ON CONFLICT(session_id) DO UPDATE
             SET last_sequence=MAX(session_counters.last_sequence, excluded.last_sequence)",
            params![session.id, signed(session.last_sequence)],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn rebind_project_path(
        &self,
        project: &str,
        path: &str,
        fresh_agent_sessions: bool,
    ) -> Result<usize, String> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        let records = {
            let mut statement = tx
                .prepare("SELECT record FROM sessions WHERE project_id=?1")
                .map_err(|e| e.to_string())?;
            let rows = statement
                .query_map([project], |row| row.get::<_, String>(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        let mut changed = 0;
        for raw in records {
            let mut session: SessionRecord =
                serde_json::from_str(&raw).map_err(|e| e.to_string())?;
            if session.task_id.is_some() || session.remote.is_some() {
                continue;
            }
            let native = if fresh_agent_sessions {
                None
            } else {
                session.native_session_id.clone()
            };
            if session.project_path == path && session.native_session_id == native {
                continue;
            }
            session.project_path = path.to_string();
            session.native_session_id = native;
            tx.execute(
                "UPDATE sessions SET record=?1 WHERE id=?2",
                params![
                    serde_json::to_string(&session).map_err(|e| e.to_string())?,
                    session.id
                ],
            )
            .map_err(|e| e.to_string())?;
            changed += 1;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(changed)
    }

    /// Stores one event. The record JSON is rewritten only when `record` is
    /// given (the record changed); otherwise only its counters move.
    pub fn append(&self, event: &AcpEvent, record: Option<&SessionRecord>) -> Result<(), String> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO events VALUES (?1,?2,?3)",
            params![
                event.session_id,
                signed(event.sequence),
                serde_json::to_string(event).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        let updated = match record {
            Some(record) => tx.execute(
                "UPDATE sessions SET record=?1, updated_at=?2 WHERE id=?3",
                params![
                    serde_json::to_string(record).map_err(|e| e.to_string())?,
                    signed(event.timestamp),
                    event.session_id
                ],
            ),
            None => tx.execute(
                "UPDATE sessions SET updated_at=?1 WHERE id=?2",
                params![signed(event.timestamp), event.session_id],
            ),
        }
        .map_err(|e| e.to_string())?;
        if updated > 0 {
            tx.execute(
                "INSERT INTO session_counters (session_id, last_sequence) VALUES (?1,?2)
                 ON CONFLICT(session_id) DO UPDATE SET last_sequence=excluded.last_sequence",
                params![event.session_id, signed(event.sequence)],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// The highest stored event sequence of a session (0 without events).
    pub fn last_sequence(&self, id: &str) -> Result<u64, String> {
        let sequence: Option<i64> = self
            .lock()?
            .query_row(
                "SELECT MAX(sequence) FROM events WHERE session_id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        Ok(sequence
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or(0))
    }

    pub fn get(&self, id: &str) -> Result<SessionRecord, String> {
        let row: Option<(String, i64, i64)> = self
            .lock()?
            .query_row(
                "SELECT record, updated_at, COALESCE((SELECT last_sequence FROM session_counters WHERE session_id=sessions.id),0) FROM sessions WHERE id=?1",
                [id],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let (record, updated_at, last_sequence) = row.ok_or("This ACP session was not found.")?;
        decode(&record, updated_at, last_sequence)
    }

    fn query_records(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
    ) -> Result<Vec<SessionRecord>, String> {
        let db = self.lock()?;
        let mut statement = db.prepare(sql).map_err(|e| e.to_string())?;
        let rows = statement
            .query_map(params, |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, i64>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        rows.map(|row| {
            let (record, updated_at, last_sequence) = row.map_err(|e| e.to_string())?;
            decode(&record, updated_at, last_sequence)
        })
        .collect()
    }

    #[cfg(test)]
    pub fn list(&self, project: Option<&str>, limit: usize) -> Result<Vec<SessionRecord>, String> {
        self.query_records(
            "SELECT record, updated_at, COALESCE((SELECT last_sequence FROM session_counters WHERE session_id=sessions.id),0) FROM sessions WHERE (?1 IS NULL OR project_id=?1) ORDER BY updated_at DESC LIMIT ?2",
            params![project, limit],
        )
    }

    /// A project's conversations, newest first: `before` is the update time
    /// of the last one already shown; `query` matches titles and agent ids
    /// literally.
    pub fn page(
        &self,
        project: &str,
        query: Option<&str>,
        before: Option<u64>,
        limit: usize,
    ) -> Result<(Vec<SessionRecord>, bool), String> {
        let limit = limit.clamp(1, 200);
        let pattern = query
            .map(str::trim)
            .filter(|query| !query.is_empty())
            .map(like_pattern);
        let mut sessions = self.query_records(
            "SELECT record, updated_at, COALESCE((SELECT last_sequence FROM session_counters WHERE session_id=sessions.id),0) FROM sessions WHERE project_id=?1
             AND (?2 IS NULL OR json_extract(record,'$.title') LIKE ?2 ESCAPE '\\'
                  OR json_extract(record,'$.agentId') LIKE ?2 ESCAPE '\\')
             AND (?3 IS NULL OR updated_at < ?3)
             ORDER BY updated_at DESC, id DESC LIMIT ?4",
            params![project, pattern, before.map(signed), limit + 1],
        )?;
        let has_more = sessions.len() > limit;
        sessions.truncate(limit);
        Ok((sessions, has_more))
    }

    /// The saved conversation an agent session id was imported or started as.
    pub fn find_by_native(
        &self,
        project: &str,
        agent: &str,
        native_session_id: &str,
    ) -> Result<Option<SessionRecord>, String> {
        Ok(self
            .query_records(
                "SELECT record, updated_at, COALESCE((SELECT last_sequence FROM session_counters WHERE session_id=sessions.id),0) FROM sessions WHERE project_id=?1
                 AND json_extract(record,'$.agentId')=?2 AND json_extract(record,'$.nativeSessionId')=?3 LIMIT 1",
                params![project, agent, native_session_id],
            )?
            .into_iter()
            .next())
    }

    /// Copies a conversation's events to another session (a fork); returns
    /// the last sequence copied.
    pub fn copy_events(&self, from: &str, to: &str) -> Result<u64, String> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO events (session_id, sequence, event)
             SELECT ?2, sequence, json_set(event, '$.sessionId', ?2) FROM events WHERE session_id=?1",
            params![from, to],
        )
        .map_err(|e| e.to_string())?;
        let last: Option<i64> = tx
            .query_row(
                "SELECT MAX(sequence) FROM events WHERE session_id=?1",
                [to],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())?;
        Ok(last
            .and_then(|value| u64::try_from(value).ok())
            .unwrap_or(0))
    }

    pub fn delete_session(&self, id: &str) -> Result<(), String> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM events WHERE session_id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM sessions WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM session_counters WHERE session_id=?1", [id])
            .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn set_title(&self, id: &str, title: &str, locked: bool) -> Result<SessionRecord, String> {
        let mut record = self.get(id)?;
        record.title = title.to_owned();
        record.title_locked = locked;
        self.save(&record)?;
        Ok(record)
    }

    pub fn byte_count(&self, id: &str) -> Result<usize, String> {
        self.lock()?
            .query_row(
                "SELECT COALESCE(SUM(length(event)),0) FROM events WHERE session_id=?1",
                [id],
                |row| row.get(0),
            )
            .map_err(|e| e.to_string())
    }

    pub fn sessions_page(
        &self,
        after_id: Option<&str>,
        limit: usize,
    ) -> Result<Vec<SessionRecord>, String> {
        self.query_records(
            "SELECT record, updated_at, COALESCE((SELECT last_sequence FROM session_counters WHERE session_id=sessions.id),0) FROM sessions WHERE (?1 IS NULL OR id>?1) ORDER BY id LIMIT ?2",
            params![after_id, limit.clamp(1, 500)],
        )
    }

    pub fn events(&self, id: &str, after: u64, limit: usize) -> Result<EventPage, String> {
        let limit = limit.clamp(1, 500);
        let db = self.lock()?;
        let mut statement = db.prepare("SELECT event FROM events WHERE session_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3").map_err(|e| e.to_string())?;
        let values = statement
            .query_map(params![id, signed(after), limit + 1], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut events = values
            .map(|v| {
                serde_json::from_str(&v.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<AcpEvent>, String>>()?;
        let has_more = events.len() > limit;
        events.truncate(limit);
        Ok(EventPage { events, has_more })
    }

    /// Every stored event of a session, oldest first.
    pub fn events_all(&self, id: &str) -> Result<Vec<AcpEvent>, String> {
        let db = self.lock()?;
        let mut statement = db
            .prepare("SELECT event FROM events WHERE session_id=?1 ORDER BY sequence")
            .map_err(|e| e.to_string())?;
        let values = statement
            .query_map([id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        values
            .map(|v| {
                serde_json::from_str(&v.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect()
    }

    pub fn agents(&self) -> Result<Vec<AgentDefinition>, String> {
        let db = self.lock()?;
        let mut statement = db
            .prepare("SELECT definition FROM agents ORDER BY id")
            .map_err(|e| e.to_string())?;
        let values = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        values
            .map(|v| {
                serde_json::from_str(&v.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect()
    }

    pub fn register(&self, definition: &AgentDefinition) -> Result<(), String> {
        self.lock()?.execute("INSERT INTO agents VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition", params![definition.id, serde_json::to_string(definition).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_agent(&self, id: &str) -> Result<(), String> {
        let mut db = self.lock()?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        for table in [
            "DELETE FROM agents WHERE id=?1",
            "DELETE FROM agent_programs WHERE id=?1",
            "DELETE FROM agent_preferences WHERE agent_id=?1",
            "DELETE FROM agent_runtime WHERE agent_id=?1",
            "DELETE FROM project_agent_settings WHERE agent_id=?1",
        ] {
            tx.execute(table, [id]).map_err(|e| e.to_string())?;
        }
        tx.commit().map_err(|e| e.to_string())
    }

    /// Programs users chose for agents, by agent id.
    pub fn agent_programs(&self) -> Result<std::collections::HashMap<String, String>, String> {
        let db = self.lock()?;
        let mut statement = db
            .prepare("SELECT id, path FROM agent_programs")
            .map_err(|e| e.to_string())?;
        let rows = statement
            .query_map([], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<_, _>>().map_err(|e| e.to_string())
    }

    pub fn agent_program(&self, id: &str) -> Result<Option<String>, String> {
        self.lock()?
            .query_row("SELECT path FROM agent_programs WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())
    }

    /// Saves the program chosen for an agent, or forgets it with `None`.
    pub fn set_agent_program(&self, id: &str, path: Option<&str>) -> Result<(), String> {
        let db = self.lock()?;
        match path {
            Some(path) => db.execute(
                "INSERT INTO agent_programs VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET path=excluded.path",
                params![id, path],
            ),
            None => db.execute("DELETE FROM agent_programs WHERE id=?1", [id]),
        }
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn read_json<T: DeserializeOwned + Default>(
        &self,
        sql: &str,
        params: impl rusqlite::Params,
    ) -> Result<T, String> {
        let value: Option<String> = self
            .lock()?
            .query_row(sql, params, |row| row.get(0))
            .optional()
            .map_err(|e| e.to_string())?;
        // A value this version cannot read falls back to the defaults.
        Ok(value
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default())
    }

    fn write_json<T: Serialize>(&self, sql: &str, key: &[&str], value: &T) -> Result<(), String> {
        let json = serde_json::to_string(value).map_err(|e| e.to_string())?;
        let db = self.lock()?;
        match key {
            [one] => db.execute(sql, params![one, json]),
            [first, second] => db.execute(sql, params![first, second, json]),
            _ => return Err(UNAVAILABLE.into()),
        }
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn preference<T: DeserializeOwned + Default>(&self, key: &str) -> Result<T, String> {
        self.read_json("SELECT value FROM preferences WHERE key=?1", [key])
    }

    pub fn set_preference<T: Serialize>(&self, key: &str, value: &T) -> Result<(), String> {
        self.write_json(
            "INSERT INTO preferences VALUES (?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            &[key],
            value,
        )
    }

    pub fn agent_preferences(&self, agent: &str) -> Result<AgentPreferences, String> {
        self.read_json(
            "SELECT prefs FROM agent_preferences WHERE agent_id=?1",
            [agent],
        )
    }

    pub fn set_agent_preferences(
        &self,
        agent: &str,
        prefs: &AgentPreferences,
    ) -> Result<(), String> {
        self.write_json(
            "INSERT INTO agent_preferences VALUES (?1,?2) ON CONFLICT(agent_id) DO UPDATE SET prefs=excluded.prefs",
            &[agent],
            prefs,
        )
    }

    pub fn project_agent_settings(
        &self,
        project: &str,
        agent: &str,
    ) -> Result<ProjectAgentSettings, String> {
        self.read_json(
            "SELECT settings FROM project_agent_settings WHERE project_id=?1 AND agent_id=?2",
            params![project, agent],
        )
    }

    pub fn set_project_agent_settings(
        &self,
        project: &str,
        agent: &str,
        settings: &ProjectAgentSettings,
    ) -> Result<(), String> {
        self.write_json(
            "INSERT INTO project_agent_settings VALUES (?1,?2,?3) ON CONFLICT(project_id, agent_id) DO UPDATE SET settings=excluded.settings",
            &[project, agent],
            settings,
        )
    }

    pub fn agent_runtime(&self, agent: &str) -> Result<Option<AgentRuntimeInfo>, String> {
        let value: Option<String> = self
            .lock()?
            .query_row(
                "SELECT info FROM agent_runtime WHERE agent_id=?1",
                [agent],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(value.and_then(|json| serde_json::from_str(&json).ok()))
    }

    pub fn set_agent_runtime(&self, agent: &str, info: &AgentRuntimeInfo) -> Result<(), String> {
        self.write_json(
            "INSERT INTO agent_runtime VALUES (?1,?2) ON CONFLICT(agent_id) DO UPDATE SET info=excluded.info",
            &[agent],
            info,
        )
    }
}
