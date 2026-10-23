//! The session store: 0.4.7 databases, cheap appends, paging, search and
//! preferences.
use super::super::preferences::{AcpPreferences, RememberedChoice, PREFERENCES_KEY};
use super::super::store::Store;
use super::super::types::*;
use rusqlite::params;
use serde_json::json;

fn record(id: &str, project: &str, title: &str, updated_at: u64) -> SessionRecord {
    SessionRecord {
        id: id.into(),
        project_id: project.into(),
        project_path: "/p".into(),
        agent_id: "claude".into(),
        title: title.into(),
        status: SessionStatus::Disconnected,
        created_at: updated_at,
        updated_at,
        ..SessionRecord::default()
    }
}

fn event(session: &str, sequence: u64) -> AcpEvent {
    AcpEvent {
        session_id: session.into(),
        project_id: "p".into(),
        agent_id: "claude".into(),
        model_id: None,
        task_id: None,
        turn_id: Some("t".into()),
        sequence,
        timestamp: 10_000 + sequence,
        kind: "agent_message_chunk".into(),
        data: json!({"content": {"type": "text", "text": "x"}}),
        owner: None,
    }
}

#[test]
fn a_0_4_7_database_opens_lists_and_appends() {
    let temp = tempfile::tempdir().unwrap();
    {
        let db = rusqlite::Connection::open(temp.path().join("sessions.sqlite")).unwrap();
        db.execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL);
            CREATE INDEX acp_sessions_project ON sessions(project_id, updated_at DESC);
            CREATE TABLE events (session_id TEXT NOT NULL REFERENCES sessions(id), sequence INTEGER NOT NULL, event TEXT NOT NULL, PRIMARY KEY(session_id,sequence));
            CREATE TABLE agents (id TEXT PRIMARY KEY, definition TEXT NOT NULL);
            CREATE TABLE agent_programs (id TEXT PRIMARY KEY, path TEXT NOT NULL);").unwrap();
        // A record as 0.4.7 wrote it: no 0.4.8 fields, status still running.
        let old = json!({"id":"s1","projectId":"p","projectPath":"/p","agentId":"claude","agentVersion":null,
            "nativeSessionId":"n1","parentSessionId":null,"taskId":null,"title":"Old","status":"running",
            "createdAt":1,"updatedAt":2,"turnId":null,
            "capabilities":{"loadSession":true,"resume":false,"image":false,"audio":false,"embeddedContext":false,"additionalDirectories":false,"mcpHttp":true},
            "controls":{"models":[],"modelId":null,"modelConfigId":null},"authMethods":[],"error":null,"lastSequence":0});
        db.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4)",
            params!["s1", "p", 2, old.to_string()],
        )
        .unwrap();
    }
    let store = Store::open(temp.path()).unwrap();
    let (page, more) = store.page("p", None, None, None, 50).unwrap();
    assert!(!more);
    assert_eq!(page[0].status, SessionStatus::Disconnected);
    store.append(&event("s1", 1), None).unwrap();
    assert_eq!(store.get("s1").unwrap().last_sequence, 1);
}

#[test]
fn a_0_4_7_build_can_still_save_sessions_after_this_one_opened_the_database() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("s1", "p", "Saved", 5)).unwrap();
    store.append(&event("s1", 1), None).unwrap();
    drop(store);
    // 0.4.7's own statement, four unnamed values.
    rusqlite::Connection::open(temp.path().join("sessions.sqlite"))
        .unwrap()
        .execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at,record=excluded.record",
            params![
                "s2",
                "p",
                7,
                serde_json::to_string(&record("s2", "p", "Downgraded", 7)).unwrap()
            ],
        )
        .unwrap();
    let store = Store::open(temp.path()).unwrap();
    assert_eq!(store.get("s1").unwrap().last_sequence, 1);
    assert_eq!(store.get("s2").unwrap().title, "Downgraded");
}

#[test]
fn a_development_builds_counter_column_moves_to_its_own_table() {
    let temp = tempfile::tempdir().unwrap();
    let path = temp.path().join("sessions.sqlite");
    {
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, updated_at INTEGER NOT NULL, record TEXT NOT NULL, last_sequence INTEGER NOT NULL DEFAULT 0);
            CREATE INDEX acp_sessions_project ON sessions(project_id, updated_at DESC);").unwrap();
        db.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4,?5)",
            params![
                "s1",
                "p",
                5,
                serde_json::to_string(&record("s1", "p", "Dev build", 5)).unwrap(),
                9
            ],
        )
        .unwrap();
    }
    let store = Store::open(temp.path()).unwrap();
    assert_eq!(store.get("s1").unwrap().last_sequence, 9);
    drop(store);
    let columns: i64 = rusqlite::Connection::open(&path)
        .unwrap()
        .query_row(
            "SELECT COUNT(*) FROM pragma_table_info('sessions')",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(columns, 4);
}

#[test]
fn append_without_a_record_keeps_the_record_json() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let saved = record("s1", "p", "Saved", 5);
    store.save(&saved).unwrap();
    let raw_before: String = rusqlite::Connection::open(temp.path().join("sessions.sqlite"))
        .unwrap()
        .query_row("SELECT record FROM sessions WHERE id='s1'", [], |row| {
            row.get(0)
        })
        .unwrap();
    store.append(&event("s1", 1), None).unwrap();
    store.append(&event("s1", 2), None).unwrap();
    let raw_after: String = rusqlite::Connection::open(temp.path().join("sessions.sqlite"))
        .unwrap()
        .query_row("SELECT record FROM sessions WHERE id='s1'", [], |row| {
            row.get(0)
        })
        .unwrap();
    assert_eq!(raw_before, raw_after);
    let loaded = store.get("s1").unwrap();
    assert_eq!(loaded.last_sequence, 2);
    assert_eq!(loaded.updated_at, 10_002);
}

#[test]
fn the_page_searches_titles_and_pages_by_update_time() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    for index in 0..120u64 {
        let title = if index % 17 == 0 {
            format!("Chapter {index}")
        } else {
            format!("Notes {index}")
        };
        store
            .save(&record(&format!("s{index:03}"), "p", &title, 1_000 + index))
            .unwrap();
    }
    store
        .save(&record("other", "q", "Chapter elsewhere", 5_000))
        .unwrap();
    let (found, more) = store.page("p", Some("chapter"), None, None, 50).unwrap();
    assert_eq!(found.len(), 8);
    assert!(!more);
    let (first, more) = store.page("p", None, None, None, 50).unwrap();
    assert_eq!(first.len(), 50);
    assert!(more);
    assert_eq!(first[0].id, "s119");
    let (second, _) = store
        .page("p", None, Some(first[49].updated_at), None, 50)
        .unwrap();
    assert_eq!(second[0].id, "s069");
}

#[test]
fn conversations_that_share_a_timestamp_are_not_skipped_between_pages() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    // A batch import stores several conversations in the same millisecond.
    for index in 0..7 {
        store
            .save(&record(&format!("s{index}"), "p", "Imported", 5_000))
            .unwrap();
    }
    store.save(&record("older", "p", "Older", 4_000)).unwrap();
    let mut seen = Vec::new();
    let mut cursor: Option<(u64, String)> = None;
    loop {
        let (page, more) = store
            .page(
                "p",
                None,
                cursor.as_ref().map(|(at, _)| *at),
                cursor.as_ref().map(|(_, id)| id.as_str()),
                3,
            )
            .unwrap();
        seen.extend(page.iter().map(|record| record.id.clone()));
        cursor = page
            .last()
            .map(|record| (record.updated_at, record.id.clone()));
        if !more {
            break;
        }
    }
    assert_eq!(seen, ["s6", "s5", "s4", "s3", "s2", "s1", "s0", "older"]);
    // A cursor with the time alone still pages by time, as before.
    let (rest, _) = store.page("p", None, Some(5_000), None, 10).unwrap();
    assert_eq!(rest.len(), 1);
}

#[test]
fn search_follows_renames_and_deletes_and_never_reads_the_records() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("a", "p", "Chapter one", 1)).unwrap();
    store.save(&record("b", "p", "Notes", 2)).unwrap();
    let ids = |query: &str| -> Vec<String> {
        store
            .page("p", Some(query), None, None, 50)
            .unwrap()
            .0
            .into_iter()
            .map(|record| record.id)
            .collect()
    };
    assert_eq!(ids("chapter"), ["a"]);
    // The agent's own title arrives with an event.
    let mut renamed = store.get("b").unwrap();
    renamed.title = "Chapter two".into();
    store.append(&event("b", 1), Some(&renamed)).unwrap();
    assert_eq!(ids("chapter"), ["b", "a"]);
    assert_eq!(ids("claude"), ["b", "a"], "the agent id is searched too");
    store.set_title("a", "Appendix", true).unwrap();
    assert_eq!(ids("chapter"), ["b"]);
    store.delete_session("b").unwrap();
    assert!(ids("chapter").is_empty());
    // Titles sit in a table of their own, one row per conversation.
    drop(store);
    let db = rusqlite::Connection::open(temp.path().join("sessions.sqlite")).unwrap();
    let searched: i64 = db
        .query_row("SELECT COUNT(*) FROM session_search", [], |row| row.get(0))
        .unwrap();
    assert_eq!(searched, 1);
}

#[test]
fn sessions_a_0_4_7_build_saved_or_deleted_are_picked_up_when_the_store_opens() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("kept", "p", "Kept", 1)).unwrap();
    store.save(&record("deleted", "p", "Gone", 2)).unwrap();
    drop(store);
    {
        let db = rusqlite::Connection::open(temp.path().join("sessions.sqlite")).unwrap();
        // 0.4.7 neither writes nor removes its search rows.
        db.execute("DELETE FROM sessions WHERE id='deleted'", [])
            .unwrap();
        db.execute(
            "INSERT INTO sessions VALUES (?1,?2,?3,?4)",
            params![
                "new",
                "p",
                3,
                serde_json::to_string(&record("new", "p", "Written by 0.4.7", 3)).unwrap()
            ],
        )
        .unwrap();
    }
    let store = Store::open(temp.path()).unwrap();
    let found = |query: &str| {
        store
            .page("p", Some(query), None, None, 50)
            .unwrap()
            .0
            .len()
    };
    assert_eq!(found("Written"), 1);
    assert_eq!(found("Gone"), 0);
    assert_eq!(found("Kept"), 1);
}

#[test]
fn opening_the_store_disconnects_sessions_with_one_update_and_keeps_the_rest() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    for (id, status) in [
        ("running", SessionStatus::Running),
        ("ready", SessionStatus::Ready),
        ("connecting", SessionStatus::Connecting),
        ("cancelling", SessionStatus::Cancelling),
        ("auth", SessionStatus::AuthRequired),
        ("done", SessionStatus::Disconnected),
        ("failed", SessionStatus::Failed),
        ("cancelled", SessionStatus::Cancelled),
    ] {
        let mut session = record(id, "p", id, 1);
        session.status = status;
        session.error = (id == "failed").then(|| "It failed.".to_string());
        session.last_sequence = 4;
        store.save(&session).unwrap();
    }
    drop(store);
    let store = Store::open(temp.path()).unwrap();
    for id in ["running", "ready", "connecting", "cancelling", "auth"] {
        let session = store.get(id).unwrap();
        assert_eq!(session.status, SessionStatus::Disconnected, "{id}");
        assert!(session.error.unwrap().contains("The app closed"), "{id}");
        assert_eq!(session.last_sequence, 4, "{id}");
        assert_eq!(session.title, id);
    }
    assert_eq!(store.get("done").unwrap().error, None);
    assert_eq!(store.get("failed").unwrap().status, SessionStatus::Failed);
    assert_eq!(
        store.get("failed").unwrap().error.as_deref(),
        Some("It failed.")
    );
    assert_eq!(
        store.get("cancelled").unwrap().status,
        SessionStatus::Cancelled
    );
}

#[test]
fn usage_events_do_not_count_toward_a_transcripts_size() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("s1", "p", "Long", 1)).unwrap();
    let mut message = event("s1", 1);
    message.data = json!({"content": {"type": "text", "text": "x".repeat(1000)}});
    store.append(&message, None).unwrap();
    let counted = store.byte_count("s1").unwrap();
    assert!(counted >= 1000);
    for sequence in 2..50 {
        let mut usage = event("s1", sequence);
        usage.kind = "usage".into();
        usage.data =
            json!({"source": "acp_context", "session": {"planMarkdown": "p".repeat(2000)}});
        store.append(&usage, None).unwrap();
    }
    assert_eq!(store.byte_count("s1").unwrap(), counted);
}

#[test]
fn a_fork_copies_every_event_in_chunks_up_to_where_the_parent_was() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("parent", "p", "Parent", 1)).unwrap();
    store.save(&record("fork", "p", "Fork", 2)).unwrap();
    for sequence in 1..=1250 {
        store.append(&event("parent", sequence), None).unwrap();
    }
    let copied = store.copy_events("parent", "fork").unwrap();
    assert_eq!(copied, 1250);
    let all = store.events_all("fork").unwrap();
    assert_eq!(all.len(), 1250);
    assert!(all.iter().all(|event| event.session_id == "fork"));
    assert_eq!(all[1249].sequence, 1250);
    // A conversation without events copies nothing.
    store.save(&record("empty", "p", "Empty", 3)).unwrap();
    assert_eq!(store.copy_events("empty", "fork2").unwrap(), 0);
}

#[test]
fn a_search_with_percent_or_underscore_matches_literally() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("a", "p", "50%_draft", 1)).unwrap();
    store
        .save(&record("b", "p", "50 percent draft", 2))
        .unwrap();
    store.save(&record("c", "p", "500x draft", 3)).unwrap();
    let (found, _) = store.page("p", Some("50%_draft"), None, None, 50).unwrap();
    assert_eq!(
        found
            .iter()
            .map(|record| record.id.as_str())
            .collect::<Vec<_>>(),
        ["a"]
    );
}

#[test]
fn preferences_round_trip_and_clamp_inactivity() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    assert_eq!(
        store.preference::<AcpPreferences>(PREFERENCES_KEY).unwrap(),
        AcpPreferences::default()
    );
    for (raw, clamped) in [(0, 5), (999, 240), (45, 45)] {
        let prefs = AcpPreferences {
            experimental_v2: true,
            inactivity_minutes: raw,
            ..Default::default()
        }
        .normalized();
        store.set_preference(PREFERENCES_KEY, &prefs).unwrap();
        let loaded: AcpPreferences = store.preference(PREFERENCES_KEY).unwrap();
        assert_eq!(loaded.inactivity_minutes, clamped);
        assert!(loaded.experimental_v2);
    }
}

#[test]
fn deleting_a_session_removes_its_events() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("s1", "p", "Gone", 1)).unwrap();
    store.append(&event("s1", 1), None).unwrap();
    store.delete_session("s1").unwrap();
    assert!(store.get("s1").is_err());
    assert!(store.events("s1", 0, 10).unwrap().events.is_empty());
}

#[test]
fn renaming_in_the_store_locks_the_title() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    store.save(&record("s1", "p", "Old", 1)).unwrap();
    let renamed = store.set_title("s1", "Thesis intro", true).unwrap();
    assert!(renamed.title_locked);
    assert_eq!(store.get("s1").unwrap().title, "Thesis intro");
}

#[test]
fn agent_preferences_and_runtime_info_round_trip() {
    let temp = tempfile::tempdir().unwrap();
    let store = Store::open(temp.path()).unwrap();
    let prefs = AgentPreferences {
        effort: Some(RememberedChoice {
            value: "high".into(),
            name: "High".into(),
        }),
        ..Default::default()
    };
    store.set_agent_preferences("claude", &prefs).unwrap();
    assert_eq!(store.agent_preferences("claude").unwrap(), prefs);
    assert_eq!(
        store.agent_preferences("codex").unwrap(),
        AgentPreferences::default()
    );
    let info = AgentRuntimeInfo {
        protocol: 1,
        steering: true,
        ..Default::default()
    };
    store.set_agent_runtime("claude", &info).unwrap();
    assert_eq!(store.agent_runtime("claude").unwrap(), Some(info));
}
