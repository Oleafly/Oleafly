use std::path::{Path, PathBuf};

use rusqlite::Connection;
use serde::Serialize;

// The SQLite WAL library at ~/.oleafly/library.db: crash-safe mirror of the
// per-project chat JSON, an FTS5 session index ("find the chat where…"), the
// usage ledger, and per-project AI budgets. The JSON files under chats/
// remain the canonical store for now; every save re-indexes here
// best-effort, and a missing or corrupted database rebuilds from JSON.

fn db_path(root: &Path) -> PathBuf {
    root.join("library.db")
}

pub fn open(root: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(root).map_err(|e| format!("failed to create data dir: {e}"))?;
    let conn =
        Connection::open(db_path(root)).map_err(|e| format!("failed to open library.db: {e}"))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| format!("failed to enable WAL: {e}"))?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chats (
            project_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            json TEXT NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            PRIMARY KEY (project_id, chat_id)
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS session_index USING fts5(
            project_id UNINDEXED,
            chat_id UNINDEXED,
            title,
            content
        );
        CREATE TABLE IF NOT EXISTS usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts_ms INTEGER NOT NULL,
            project_id TEXT NOT NULL,
            chat_id TEXT NOT NULL,
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL,
            output_tokens INTEGER NOT NULL,
            cost_usd REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS usage_project ON usage(project_id);
        CREATE TABLE IF NOT EXISTS budgets (
            project_id TEXT PRIMARY KEY,
            budget_usd REAL NOT NULL
        );
        CREATE TABLE IF NOT EXISTS threads (
            thread_id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL DEFAULT '',
            title TEXT NOT NULL DEFAULT '',
            turn_count INTEGER NOT NULL DEFAULT 0,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            created_at_ms INTEGER NOT NULL,
            updated_at_ms INTEGER NOT NULL,
            archived INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS threads_project ON threads(project_id);
        CREATE VIRTUAL TABLE IF NOT EXISTS thread_index USING fts5(
            thread_id UNINDEXED,
            content
        );",
    )
    .map_err(|e| format!("failed to create library schema: {e}"))?;
    Ok(conn)
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn chat_text(chat: &serde_json::Value) -> (String, String, String) {
    let chat_id = chat
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let title = chat
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let mut content = String::new();
    if let Some(messages) = chat.get("messages").and_then(|v| v.as_array()) {
        for message in messages {
            if let Some(text) = message.get("content").and_then(|v| v.as_str()) {
                content.push_str(text);
                content.push('\n');
            }
        }
    }
    (chat_id, title, content)
}

/// Mirrors one project's chats JSON into the store and rebuilds its rows in
/// the session index.
pub fn index_project_chats(root: &Path, project_id: &str, json: &str) -> Result<(), String> {
    let parsed: serde_json::Value =
        serde_json::from_str(json).map_err(|e| format!("chats json invalid: {e}"))?;
    let chats = parsed.as_array().cloned().unwrap_or_default();
    let mut conn = open(root)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("library tx failed: {e}"))?;
    tx.execute("DELETE FROM chats WHERE project_id = ?1", [project_id])
        .map_err(|e| format!("library chats delete failed: {e}"))?;
    tx.execute(
        "DELETE FROM session_index WHERE project_id = ?1",
        [project_id],
    )
    .map_err(|e| format!("library index delete failed: {e}"))?;
    for chat in &chats {
        let (chat_id, title, content) = chat_text(chat);
        if chat_id.is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO chats (project_id, chat_id, title, json, updated_at_ms)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![project_id, chat_id, title, chat.to_string(), now_ms()],
        )
        .map_err(|e| format!("library chat insert failed: {e}"))?;
        tx.execute(
            "INSERT INTO session_index (project_id, chat_id, title, content)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![project_id, chat_id, title, content],
        )
        .map_err(|e| format!("library index insert failed: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("library commit failed: {e}"))
}

/// First-run (or recovery) indexing of every chats/<project>.json on disk.
pub fn reindex_all(root: &Path) -> Result<usize, String> {
    let chats_dir = root.join("chats");
    let Ok(entries) = std::fs::read_dir(&chats_dir) else {
        return Ok(0);
    };
    let mut indexed = 0;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let Some(project_id) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(json) = std::fs::read_to_string(&path) else {
            continue;
        };
        if index_project_chats(root, project_id, &json).is_ok() {
            indexed += 1;
        }
    }
    Ok(indexed)
}

#[derive(Clone, Serialize)]
pub struct ChatSearchHit {
    pub project_id: String,
    pub chat_id: String,
    pub title: String,
    pub snippet: String,
}

pub fn search_chats(root: &Path, query: &str, limit: u32) -> Result<Vec<ChatSearchHit>, String> {
    let conn = open(root)?;
    let mut statement = conn
        .prepare(
            "SELECT project_id, chat_id, title,
                    snippet(session_index, 3, '', '', ' … ', 12)
             FROM session_index
             WHERE session_index MATCH ?1
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| format!("library search prepare failed: {e}"))?;
    let rows = statement
        .query_map(rusqlite::params![query, limit], |row| {
            Ok(ChatSearchHit {
                project_id: row.get(0)?,
                chat_id: row.get(1)?,
                title: row.get(2)?,
                snippet: row.get(3)?,
            })
        })
        .map_err(|e| format!("library search failed: {e}"))?;
    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(|e| format!("library search row failed: {e}"))?);
    }
    Ok(hits)
}

#[derive(Clone, Copy, Serialize)]
pub struct UsageTotals {
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub cost_usd: f64,
}

#[allow(clippy::too_many_arguments)]
pub fn record_usage(
    root: &Path,
    project_id: &str,
    chat_id: &str,
    provider: &str,
    model: &str,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> Result<(), String> {
    let conn = open(root)?;
    conn.execute(
        "INSERT INTO usage (ts_ms, project_id, chat_id, provider, model,
                            input_tokens, output_tokens, cost_usd)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            now_ms(),
            project_id,
            chat_id,
            provider,
            model,
            input_tokens,
            output_tokens,
            cost_usd
        ],
    )
    .map_err(|e| format!("usage insert failed: {e}"))?;
    Ok(())
}

pub fn usage_totals(root: &Path, project_id: &str) -> Result<UsageTotals, String> {
    let conn = open(root)?;
    conn.query_row(
        "SELECT COALESCE(SUM(input_tokens), 0), COALESCE(SUM(output_tokens), 0),
                COALESCE(SUM(cost_usd), 0)
         FROM usage WHERE project_id = ?1",
        [project_id],
        |row| {
            Ok(UsageTotals {
                input_tokens: row.get(0)?,
                output_tokens: row.get(1)?,
                cost_usd: row.get(2)?,
            })
        },
    )
    .map_err(|e| format!("usage totals failed: {e}"))
}

pub fn budget_get(root: &Path, project_id: &str) -> Result<Option<f64>, String> {
    let conn = open(root)?;
    conn.query_row(
        "SELECT budget_usd FROM budgets WHERE project_id = ?1",
        [project_id],
        |row| row.get(0),
    )
    .map(Some)
    .or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(format!("budget read failed: {other}")),
    })
}

pub fn budget_set(root: &Path, project_id: &str, budget_usd: Option<f64>) -> Result<(), String> {
    let conn = open(root)?;
    match budget_usd {
        Some(budget) => conn
            .execute(
                "INSERT INTO budgets (project_id, budget_usd) VALUES (?1, ?2)
                 ON CONFLICT(project_id) DO UPDATE SET budget_usd = ?2",
                rusqlite::params![project_id, budget],
            )
            .map(|_| ())
            .map_err(|e| format!("budget write failed: {e}")),
        None => conn
            .execute("DELETE FROM budgets WHERE project_id = ?1", [project_id])
            .map(|_| ())
            .map_err(|e| format!("budget delete failed: {e}")),
    }
}

static INDEX_BOOTSTRAP: std::sync::Once = std::sync::Once::new();

/// Text a thread search should match: message bodies, reasoning summaries,
/// tool outputs.
fn thread_search_text(record: &oleafly_agent::items::TurnRecord) -> String {
    use oleafly_agent::items::ThreadItem;
    let mut content = String::new();
    for recorded in &record.items {
        match &recorded.item {
            ThreadItem::UserMessage { text }
            | ThreadItem::AgentMessage { text }
            | ThreadItem::SteeringUserMessage { text, .. }
            | ThreadItem::HookPrompt { prompt: text } => {
                content.push_str(text);
                content.push('\n');
            }
            ThreadItem::Reasoning { summary, .. } => {
                for part in summary {
                    content.push_str(part);
                    content.push('\n');
                }
            }
            ThreadItem::CommandExecution {
                aggregated_output, ..
            } => {
                content.push_str(aggregated_output);
                content.push('\n');
            }
            ThreadItem::DynamicToolCall {
                output: Some(out), ..
            } => {
                content.push_str(out);
                content.push('\n');
            }
            _ => {}
        }
    }
    content
}

/// Rewrite one thread's mirror rows from its rollout turns. The rollout file
/// stays canonical; these tables are a rebuildable listing/search surface.
pub fn resync_thread(
    root: &Path,
    thread_id: &str,
    project_id: &str,
    turns: &[oleafly_agent::items::TurnRecord],
) -> Result<(), String> {
    let mut conn = open(root)?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("library tx failed: {e}"))?;
    tx.execute("DELETE FROM threads WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("thread delete failed: {e}"))?;
    tx.execute("DELETE FROM thread_index WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("thread index delete failed: {e}"))?;
    if turns.is_empty() {
        tx.commit()
            .map_err(|e| format!("library commit failed: {e}"))?;
        return Ok(());
    }
    let input: i64 = turns.iter().map(|t| i64::from(t.usage.input)).sum();
    let output: i64 = turns.iter().map(|t| i64::from(t.usage.output)).sum();
    tx.execute(
        "INSERT INTO threads (thread_id, project_id, title, turn_count,
                              input_tokens, output_tokens,
                              created_at_ms, updated_at_ms, archived)
         VALUES (?1, ?2, '', ?3, ?4, ?5, ?6, ?7, 0)",
        rusqlite::params![
            thread_id,
            project_id,
            turns.len(),
            input,
            output,
            now_ms(),
            now_ms()
        ],
    )
    .map_err(|e| format!("thread insert failed: {e}"))?;
    for record in turns {
        let content = thread_search_text(record);
        if content.trim().is_empty() {
            continue;
        }
        tx.execute(
            "INSERT INTO thread_index (thread_id, content) VALUES (?1, ?2)",
            rusqlite::params![thread_id, content],
        )
        .map_err(|e| format!("thread index insert failed: {e}"))?;
    }
    tx.commit()
        .map_err(|e| format!("library commit failed: {e}"))
}

/// Mark a thread archived (kept on disk, out of default listings).
pub fn archive_thread(root: &Path, thread_id: &str) -> Result<(), String> {
    let conn = open(root)?;
    conn.execute(
        "UPDATE threads SET archived = 1 WHERE thread_id = ?1",
        [thread_id],
    )
    .map_err(|e| format!("thread archive failed: {e}"))?;
    Ok(())
}

/// Drop a thread's mirror rows entirely.
pub fn drop_thread(root: &Path, thread_id: &str) -> Result<(), String> {
    let conn = open(root)?;
    conn.execute("DELETE FROM threads WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("thread delete failed: {e}"))?;
    conn.execute("DELETE FROM thread_index WHERE thread_id = ?1", [thread_id])
        .map_err(|e| format!("thread index delete failed: {e}"))?;
    Ok(())
}

#[derive(Clone, Serialize)]
pub struct ThreadSummary {
    pub thread_id: String,
    pub project_id: String,
    pub title: String,
    pub turn_count: i64,
    pub input_tokens: i64,
    pub output_tokens: i64,
    pub updated_at_ms: i64,
    pub archived: bool,
}

pub fn thread_summaries(root: &Path, include_archived: bool) -> Result<Vec<ThreadSummary>, String> {
    let conn = open(root)?;
    let sql = if include_archived {
        "SELECT thread_id, project_id, title, turn_count, input_tokens,
                output_tokens, updated_at_ms, archived
         FROM threads ORDER BY updated_at_ms DESC"
    } else {
        "SELECT thread_id, project_id, title, turn_count, input_tokens,
                output_tokens, updated_at_ms, archived
         FROM threads WHERE archived = 0 ORDER BY updated_at_ms DESC"
    };
    let mut statement = conn
        .prepare(sql)
        .map_err(|e| format!("thread list prepare failed: {e}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok(ThreadSummary {
                thread_id: row.get(0)?,
                project_id: row.get(1)?,
                title: row.get(2)?,
                turn_count: row.get(3)?,
                input_tokens: row.get(4)?,
                output_tokens: row.get(5)?,
                updated_at_ms: row.get(6)?,
                archived: row.get::<_, i64>(7)? != 0,
            })
        })
        .map_err(|e| format!("thread list failed: {e}"))?;
    let mut summaries = Vec::new();
    for row in rows {
        summaries.push(row.map_err(|e| format!("thread list row failed: {e}"))?);
    }
    Ok(summaries)
}

#[derive(Clone, Serialize)]
pub struct ThreadSearchHit {
    pub thread_id: String,
    pub project_id: String,
    pub snippet: String,
}

pub fn search_threads(
    root: &Path,
    query: &str,
    limit: u32,
) -> Result<Vec<ThreadSearchHit>, String> {
    let conn = open(root)?;
    let mut statement = conn
        .prepare(
            "SELECT t.thread_id, t.project_id,
                    snippet(thread_index, 1, '', '', ' … ', 12)
             FROM thread_index f
             JOIN threads t ON t.thread_id = f.thread_id
             WHERE thread_index MATCH ?1 AND t.archived = 0
             ORDER BY rank
             LIMIT ?2",
        )
        .map_err(|e| format!("thread search prepare failed: {e}"))?;
    let rows = statement
        .query_map(rusqlite::params![query, limit], |row| {
            Ok(ThreadSearchHit {
                thread_id: row.get(0)?,
                project_id: row.get(1)?,
                snippet: row.get(2)?,
            })
        })
        .map_err(|e| format!("thread search failed: {e}"))?;
    let mut hits = Vec::new();
    for row in rows {
        hits.push(row.map_err(|e| format!("thread search row failed: {e}"))?);
    }
    Ok(hits)
}

fn ensure_indexed(root: &Path) {
    INDEX_BOOTSTRAP.call_once(|| {
        let _ = reindex_all(root);
    });
}

#[tauri::command]
pub async fn chats_search(query: String) -> Result<Vec<ChatSearchHit>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        ensure_indexed(&root);
        search_chats(&root, &query, 30)
    })
    .await
    .map_err(|e| format!("chat search task failed: {e}"))?
}

#[tauri::command]
pub async fn usage_record(
    project_id: String,
    chat_id: String,
    provider: String,
    model: String,
    input_tokens: i64,
    output_tokens: i64,
    cost_usd: f64,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        record_usage(
            &root,
            &project_id,
            &chat_id,
            &provider,
            &model,
            input_tokens,
            output_tokens,
            cost_usd,
        )
    })
    .await
    .map_err(|e| format!("usage record task failed: {e}"))?
}

#[tauri::command]
pub async fn usage_summary(project_id: String) -> Result<UsageTotals, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::paths::oleafly_root()?;
        usage_totals(&root, &project_id)
    })
    .await
    .map_err(|e| format!("usage summary task failed: {e}"))?
}

#[tauri::command]
pub async fn budget_get_cmd(project_id: String) -> Result<Option<f64>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        budget_get(&crate::paths::oleafly_root()?, &project_id)
    })
    .await
    .map_err(|e| format!("budget get task failed: {e}"))?
}

#[tauri::command]
pub async fn budget_set_cmd(project_id: String, budget_usd: Option<f64>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        budget_set(&crate::paths::oleafly_root()?, &project_id, budget_usd)
    })
    .await
    .map_err(|e| format!("budget set task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_root(tag: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("oleafly-library-{tag}-{}", std::process::id()));
        std::fs::remove_dir_all(&dir).ok();
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const CHATS: &str = r#"[
        {"id":"chat-1","title":"Bib fixes","messages":[
            {"role":"user","content":"fix my bibfile"},
            {"role":"assistant","content":"The bibliography entry for Knuth was malformed."}]},
        {"id":"chat-2","title":"Figures","messages":[
            {"role":"user","content":"draw a tikz diagram"}]}
    ]"#;

    #[test]
    fn indexes_and_finds_chats_by_content() {
        let root = temp_root("fts");
        index_project_chats(&root, "proj", CHATS).unwrap();

        let hits = search_chats(&root, "bibfile", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].chat_id, "chat-1");
        assert_eq!(hits[0].title, "Bib fixes");

        let hits = search_chats(&root, "tikz", 10).unwrap();
        assert_eq!(hits[0].chat_id, "chat-2");
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reindex_replaces_stale_rows() {
        let root = temp_root("stale");
        index_project_chats(&root, "proj", CHATS).unwrap();
        index_project_chats(
            &root,
            "proj",
            r#"[{"id":"chat-3","title":"New","messages":[{"role":"user","content":"synctex"}]}]"#,
        )
        .unwrap();

        assert!(search_chats(&root, "bibfile", 10).unwrap().is_empty());
        assert_eq!(search_chats(&root, "synctex", 10).unwrap().len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn reindex_all_imports_existing_json_files() {
        let root = temp_root("import");
        let chats_dir = root.join("chats");
        std::fs::create_dir_all(&chats_dir).unwrap();
        std::fs::write(chats_dir.join("proj-a.json"), CHATS).unwrap();

        assert_eq!(reindex_all(&root).unwrap(), 1);
        assert_eq!(search_chats(&root, "bibfile", 10).unwrap().len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn usage_ledger_accumulates_per_project() {
        let root = temp_root("usage");
        record_usage(&root, "proj", "chat-1", "openai", "gpt", 100, 50, 0.012).unwrap();
        record_usage(&root, "proj", "chat-1", "openai", "gpt", 200, 100, 0.024).unwrap();
        record_usage(&root, "other", "chat-9", "openai", "gpt", 5, 5, 0.001).unwrap();

        let totals = usage_totals(&root, "proj").unwrap();
        assert_eq!(totals.input_tokens, 300);
        assert_eq!(totals.output_tokens, 150);
        assert!((totals.cost_usd - 0.036).abs() < 1e-9);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn budgets_round_trip_and_clear() {
        let root = temp_root("budget");
        assert_eq!(budget_get(&root, "proj").unwrap(), None);
        budget_set(&root, "proj", Some(5.0)).unwrap();
        assert_eq!(budget_get(&root, "proj").unwrap(), Some(5.0));
        budget_set(&root, "proj", None).unwrap();
        assert_eq!(budget_get(&root, "proj").unwrap(), None);
        std::fs::remove_dir_all(&root).ok();
    }

    #[test]
    fn corrupted_database_recovers_by_rebuild() {
        let root = temp_root("corrupt");
        index_project_chats(&root, "proj", CHATS).unwrap();
        std::fs::write(db_path(&root), b"not a database").unwrap();

        if open(&root).is_err() {
            std::fs::remove_file(db_path(&root)).unwrap();
        }
        index_project_chats(&root, "proj", CHATS).unwrap();
        assert_eq!(search_chats(&root, "bibfile", 10).unwrap().len(), 1);
        std::fs::remove_dir_all(&root).ok();
    }

    fn turn(
        turn_id: &str,
        text: &str,
        input: u32,
        output: u32,
    ) -> oleafly_agent::items::TurnRecord {
        use oleafly_agent::event::AgentEvent;
        let mut recorder = oleafly_agent::items::TurnRecorder::new(turn_id);
        recorder.record(&AgentEvent::TextDelta { text: text.into() });
        recorder.record(&AgentEvent::Usage {
            usage: oleafly_agent::Usage { input, output },
        });
        recorder.finish(false);
        recorder.into_record()
    }

    #[test]
    fn thread_mirrors_resync_list_search_and_archive() {
        let root = temp_root("threads");
        let turns = vec![
            turn("turn-1", "fixed the bibfile entry", 100, 50),
            turn("turn-2", "compiled the document", 200, 60),
        ];
        resync_thread(&root, "thread-1", "proj", &turns).unwrap();

        let summaries = thread_summaries(&root, false).unwrap();
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].turn_count, 2);
        assert_eq!(summaries[0].input_tokens, 300);
        assert_eq!(summaries[0].output_tokens, 110);
        assert!(!summaries[0].archived);

        let hits = search_threads(&root, "bibfile", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].thread_id, "thread-1");
        assert!(hits[0].snippet.contains("bibfile"));

        // A resync with no turns drops the thread from listings.
        resync_thread(&root, "thread-1", "proj", &[]).unwrap();
        assert!(thread_summaries(&root, false).unwrap().is_empty());

        // Archived threads stay out of default listings and search.
        resync_thread(&root, "thread-2", "proj", &turns).unwrap();
        archive_thread(&root, "thread-2").unwrap();
        assert!(thread_summaries(&root, false).unwrap().is_empty());
        assert_eq!(thread_summaries(&root, true).unwrap().len(), 1);
        assert!(search_threads(&root, "bibfile", 10).unwrap().is_empty());

        drop_thread(&root, "thread-2").unwrap();
        assert!(thread_summaries(&root, true).unwrap().is_empty());
        std::fs::remove_dir_all(&root).ok();
    }
}
