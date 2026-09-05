use super::types::{AcpEvent, AgentDefinition, EventPage, SessionRecord, SessionStatus};
use rusqlite::{params, Connection, OptionalExtension};
use std::{path::Path, sync::Mutex};

pub struct Store {
    db: Mutex<Connection>,
}

impl Store {
    pub fn open(root: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let db = Connection::open(root.join("sessions.sqlite")).map_err(|e| e.to_string())?;
        db.busy_timeout(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;
            CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL);
            CREATE INDEX IF NOT EXISTS acp_sessions_project ON sessions(project_id, updated_at DESC);
            CREATE TABLE IF NOT EXISTS events (session_id TEXT NOT NULL REFERENCES sessions(id), sequence INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(session_id,sequence));
            CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, definition TEXT NOT NULL);").map_err(|e| e.to_string())?;
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

    pub fn save(&self, session: &SessionRecord) -> Result<(), String> {
        let record = serde_json::to_string(session).map_err(|e| e.to_string())?;
        self.db.lock().map_err(|_| "ACP storage is unavailable.")?.execute("INSERT INTO sessions VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,record=excluded.record", params![session.id, session.project_id, session.updated_at, record]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn append(&self, session: &SessionRecord, event: &AcpEvent) -> Result<(), String> {
        let mut db = self.db.lock().map_err(|_| "ACP storage is unavailable.")?;
        let tx = db.transaction().map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO events VALUES (?1,?2,?3)",
            params![
                event.session_id,
                event.sequence,
                serde_json::to_string(event).map_err(|e| e.to_string())?
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE sessions SET record=?1,updated_at=?2 WHERE id=?3",
            params![
                serde_json::to_string(session).map_err(|e| e.to_string())?,
                session.updated_at,
                session.id
            ],
        )
        .map_err(|e| e.to_string())?;
        tx.commit().map_err(|e| e.to_string())
    }

    pub fn get(&self, id: &str) -> Result<SessionRecord, String> {
        let value: Option<String> = self
            .db
            .lock()
            .map_err(|_| "ACP storage is unavailable.")?
            .query_row("SELECT record FROM sessions WHERE id=?1", [id], |row| {
                row.get(0)
            })
            .optional()
            .map_err(|e| e.to_string())?;
        serde_json::from_str(&value.ok_or("This ACP session was not found.")?)
            .map_err(|e| e.to_string())
    }

    pub fn list(&self, project: Option<&str>, limit: usize) -> Result<Vec<SessionRecord>, String> {
        let db = self.db.lock().map_err(|_| "ACP storage is unavailable.")?;
        let mut statement = db.prepare("SELECT record FROM sessions WHERE (?1 IS NULL OR project_id=?1) ORDER BY updated_at DESC LIMIT ?2").map_err(|e| e.to_string())?;
        let values = statement
            .query_map(params![project, limit], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        values
            .map(|v| {
                serde_json::from_str(&v.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect()
    }

    pub fn byte_count(&self, id: &str) -> Result<usize, String> {
        self.db
            .lock()
            .map_err(|_| "ACP storage is unavailable.")?
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
        let db = self.db.lock().map_err(|_| "ACP storage is unavailable.")?;
        let mut statement = db
            .prepare("SELECT record FROM sessions WHERE (?1 IS NULL OR id>?1) ORDER BY id LIMIT ?2")
            .map_err(|e| e.to_string())?;
        let values = statement
            .query_map(params![after_id, limit.clamp(1, 500)], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        values
            .map(|v| {
                serde_json::from_str(&v.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
            })
            .collect()
    }

    pub fn events(&self, id: &str, after: u64, limit: usize) -> Result<EventPage, String> {
        let limit = limit.clamp(1, 500);
        let db = self.db.lock().map_err(|_| "ACP storage is unavailable.")?;
        let mut statement = db.prepare("SELECT event FROM events WHERE session_id=?1 AND sequence>?2 ORDER BY sequence LIMIT ?3").map_err(|e| e.to_string())?;
        let values = statement
            .query_map(params![id, after, limit + 1], |row| row.get::<_, String>(0))
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

    pub fn agents(&self) -> Result<Vec<AgentDefinition>, String> {
        let db = self.db.lock().map_err(|_| "ACP storage is unavailable.")?;
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
        self.db.lock().map_err(|_| "ACP storage is unavailable.")?.execute("INSERT INTO agents VALUES (?1,?2) ON CONFLICT(id) DO UPDATE SET definition=excluded.definition", params![definition.id, serde_json::to_string(definition).map_err(|e| e.to_string())?]).map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_agent(&self, id: &str) -> Result<(), String> {
        self.db
            .lock()
            .map_err(|_| "ACP storage is unavailable.")?
            .execute("DELETE FROM agents WHERE id=?1", [id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
