use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

use oleafly_agent::items::TurnRecord;

/// Where a thread's rollout lives (and lives on after archiving).
fn rollout_path_under(sessions_root: &Path, thread_id: &str) -> PathBuf {
    sessions_root
        .join("sessions")
        .join(format!("rollout-{thread_id}.jsonl"))
}

fn archive_path_under(sessions_root: &Path, thread_id: &str) -> PathBuf {
    sessions_root
        .join("archived_sessions")
        .join(format!("rollout-{thread_id}.jsonl"))
}

fn sanitized_thread_id(thread_id: &str) -> Result<String, String> {
    let clean: String = thread_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    if clean.is_empty() || clean != thread_id {
        return Err("thread id must be non-empty alphanumeric/-/_".into());
    }
    Ok(clean)
}

pub fn rollout_path(sessions_root: &Path, thread_id: &str) -> Result<PathBuf, String> {
    Ok(rollout_path_under(
        sessions_root,
        &sanitized_thread_id(thread_id)?,
    ))
}

/// Truncate a torn trailing line (a crash mid-append leaves bytes with no
/// closing newline) back to the last complete record. The reader tolerates a
/// torn final line, but a blind append would fuse the new record onto the
/// fragment, turning a skippable tail into permanent mid-file corruption.
fn heal_torn_tail(path: &Path) -> Result<(), String> {
    let mut file = match OpenOptions::new().read(true).write(true).open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let len = file.metadata().map_err(|e| e.to_string())?.len();
    if len == 0 {
        return Ok(());
    }
    let mut position = len;
    let mut chunk = [0u8; 8192];
    let mut last_newline: Option<u64> = None;
    while position > 0 {
        let read_len = position.min(chunk.len() as u64);
        let start = position - read_len;
        file.seek(SeekFrom::Start(start))
            .map_err(|e| e.to_string())?;
        let slice = &mut chunk[..read_len as usize];
        file.read_exact(slice).map_err(|e| e.to_string())?;
        if let Some(offset) = slice.iter().rposition(|byte| *byte == b'\n') {
            last_newline = Some(start + offset as u64);
            break;
        }
        position = start;
    }
    // A complete file ends in '\n'; nothing to heal.
    if last_newline == Some(len - 1) {
        return Ok(());
    }
    // Truncate to just after the last complete record (or to empty when no
    // record ever completed).
    let keep = last_newline.map_or(0, |offset| offset + 1);
    file.set_len(keep).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}

/// Append one completed turn to the thread's rollout, creating the file on
/// first write. Writes are a single `write_all` of one line so a crash
/// mid-write at worst corrupts the trailing line, which the reader skips and
/// the next append heals before writing.
pub fn append_turn(
    sessions_root: &Path,
    thread_id: &str,
    record: &TurnRecord,
) -> Result<(), String> {
    let path = rollout_path(sessions_root, thread_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    heal_torn_tail(&path)?;
    let mut line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    line.push('\n');
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    crate::fsperm::harden_file(&path);
    file.write_all(line.as_bytes())
        .and_then(|_| file.flush())
        .map_err(|e| e.to_string())
}

/// Replay a thread's turns in order. A corrupt trailing line (torn write) is
/// skipped; a corrupt line in the middle aborts the read so replay never
/// silently drops history.
pub fn read_turns(sessions_root: &Path, thread_id: &str) -> Result<Vec<TurnRecord>, String> {
    let path = rollout_path(sessions_root, thread_id)?;
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let lines: Vec<String> = BufReader::new(file)
        .lines()
        .collect::<std::io::Result<_>>()
        .map_err(|e| e.to_string())?;
    let mut turns = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if line.trim().is_empty() {
            continue;
        }
        match serde_json::from_str::<TurnRecord>(line) {
            Ok(record) => turns.push(record),
            // A torn trailing write: drop it.
            Err(_) if index == lines.len() - 1 => {}
            Err(error) => {
                return Err(format!("rollout line {index} is corrupt: {error}"));
            }
        }
    }
    Ok(turns)
}

/// Drop the last `num_turns` turns (the retry-turn flow rolls back one).
pub fn rollback_turns(
    sessions_root: &Path,
    thread_id: &str,
    num_turns: usize,
) -> Result<Vec<TurnRecord>, String> {
    let mut turns = read_turns(sessions_root, thread_id)?;
    let drop = num_turns.min(turns.len());
    turns.truncate(turns.len() - drop);
    rewrite(sessions_root, thread_id, &turns)?;
    Ok(turns)
}

/// Fork: copy the first `turns.len() - exclude_turns` turns into a new
/// thread's rollout. Zero-copy for the excluded tail.
pub fn fork_turns(
    sessions_root: &Path,
    source_thread_id: &str,
    new_thread_id: &str,
    exclude_turns: usize,
) -> Result<Vec<TurnRecord>, String> {
    let turns = read_turns(sessions_root, source_thread_id)?;
    let keep = turns.len().saturating_sub(exclude_turns);
    let forked: Vec<TurnRecord> = turns[..keep].to_vec();
    rewrite(sessions_root, new_thread_id, &forked)?;
    Ok(forked)
}

/// Rewrite the whole rollout (rollback/fork). Staged to a temp file and
/// atomically renamed so a crash never truncates the real rollout.
fn rewrite(sessions_root: &Path, thread_id: &str, turns: &[TurnRecord]) -> Result<(), String> {
    let path = rollout_path(sessions_root, thread_id)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("jsonl.tmp");
    {
        let mut file = File::create(&temp).map_err(|e| e.to_string())?;
        for record in turns {
            let mut line = serde_json::to_string(record).map_err(|e| e.to_string())?;
            line.push('\n');
            file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
        }
        file.flush().map_err(|e| e.to_string())?;
    }
    crate::fsperm::harden_file(&temp);
    fs::rename(&temp, &path).map_err(|e| e.to_string())
}

/// Move a thread's rollout to the archive tree. Returns false when there was
/// nothing to archive (a missing rollout for a thread id is not an error —
/// the desktop treats it as recoverable).
pub fn archive(sessions_root: &Path, thread_id: &str) -> Result<bool, String> {
    let source = rollout_path(sessions_root, thread_id)?;
    if !source.exists() {
        return Ok(false);
    }
    let destination = archive_path_under(sessions_root, thread_id);
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::rename(&source, &destination)
        .map_err(|e| e.to_string())
        .map(|_| true)
}

/// Delete a thread's rollout from both the active tree and the archive.
pub fn delete(sessions_root: &Path, thread_id: &str) -> Result<(), String> {
    let thread_id = sanitized_thread_id(thread_id)?;
    for path in [
        rollout_path_under(sessions_root, &thread_id),
        archive_path_under(sessions_root, &thread_id),
    ] {
        if path.exists() {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Every thread id with an active rollout, oldest-file first.
pub fn list_threads(sessions_root: &Path) -> Result<Vec<String>, String> {
    let sessions = sessions_root.join("sessions");
    let entries = match fs::read_dir(&sessions) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()),
    };
    let mut found: Vec<(std::time::SystemTime, String)> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let modified = entry
                .metadata()
                .ok()
                .and_then(|meta| meta.modified().ok())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            let id = name
                .strip_prefix("rollout-")?
                .strip_suffix(".jsonl")?
                .to_string();
            Some((modified, id))
        })
        .collect();
    found.sort();
    Ok(found.into_iter().map(|(_, id)| id).collect())
}

/// Read-path migration: expand one legacy StoredChat's messages into turn
/// records, mirroring the shell's `chatMessagesToTurns` (a user message
/// opens a turn; reasoning blocks anchor before their tool; the assistant
/// message closes it).
pub fn turns_from_legacy_chat(chat: &serde_json::Value) -> Vec<TurnRecord> {
    use oleafly_agent::items::{ExecutionStatus, RecordedItem, ThreadItem, TurnRecordStatus};

    let messages = chat
        .get("messages")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut turns: Vec<TurnRecord> = Vec::new();
    let mut seq: u32 = 0;

    fn open_turn<'a>(turns: &'a mut Vec<TurnRecord>, seq: &mut u32) -> &'a mut TurnRecord {
        *seq += 1;
        turns.push(TurnRecord {
            turn_id: format!("legacy-{seq}"),
            client_turn_id: None,
            status: TurnRecordStatus::Completed,
            items: Vec::new(),
            usage: oleafly_agent::Usage::default(),
            error: None,
            stopped_at_cap: false,
        });
        turns.last_mut().expect("just pushed")
    }

    for message in &messages {
        let role = message.get("role").and_then(|v| v.as_str()).unwrap_or("");
        let content = message
            .get("content")
            .and_then(|v| v.as_str())
            .unwrap_or_default();
        if role == "user" {
            let turn = open_turn(&mut turns, &mut seq);
            turn.items.push(RecordedItem {
                id: format!("{}:{}", turn.turn_id, turn.items.len()),
                item: ThreadItem::UserMessage {
                    text: content.to_string(),
                },
                completed: true,
            });
            continue;
        }

        if turns.is_empty() {
            // An assistant message before any user message still needs a
            // turn to live in.
            open_turn(&mut turns, &mut seq);
        }
        let turn = turns.last_mut().expect("just opened");
        let tools = message
            .get("toolCalls")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let blocks = message
            .get("reasoningBlocks")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();

        let push_item = |turn: &mut TurnRecord, item: ThreadItem, completed: bool| {
            turn.items.push(RecordedItem {
                id: format!("{}:{}", turn.turn_id, turn.items.len()),
                item,
                completed,
            });
        };

        for anchor in 0..=tools.len() {
            for block in &blocks {
                let before_tool = block
                    .get("beforeTool")
                    .and_then(|v| v.as_u64())
                    .unwrap_or(0);
                if (before_tool.min(tools.len() as u64) as usize) != anchor {
                    continue;
                }
                let text = block
                    .get("text")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                push_item(
                    turn,
                    ThreadItem::Reasoning {
                        summary: vec![text.to_string()],
                        content: Vec::new(),
                    },
                    true,
                );
            }
            if anchor >= tools.len() {
                continue;
            }
            let tool = &tools[anchor];
            let name = tool.get("name").and_then(|v| v.as_str()).unwrap_or("tool");
            let output = tool.get("output").and_then(|v| v.as_str());
            let approval = tool.get("approval").and_then(|v| v.as_str());
            let rejected = approval == Some("rejected");
            let errored = tool.get("status").and_then(|v| v.as_str()) == Some("error")
                || output.is_some_and(|out| out.contains("\"error\""));
            let status = if rejected {
                ExecutionStatus::Declined
            } else if errored {
                ExecutionStatus::Failed
            } else {
                ExecutionStatus::Completed
            };
            let mut item = oleafly_agent::items::classify_tool(name);
            match &mut item {
                ThreadItem::CommandExecution {
                    aggregated_output,
                    exit_code,
                    status: item_status,
                    ..
                } => {
                    *aggregated_output = output.unwrap_or_default().to_string();
                    *exit_code = Some(i32::from(errored));
                    *item_status = status;
                }
                ThreadItem::FileChange {
                    status: item_status,
                    ..
                } => *item_status = status,
                ThreadItem::DynamicToolCall {
                    output: out,
                    status: item_status,
                    ..
                } => {
                    *out = output.map(str::to_string);
                    *item_status = status;
                }
                _ => {}
            }
            push_item(turn, item, true);
        }

        if !content.is_empty() {
            push_item(
                turn,
                ThreadItem::AgentMessage {
                    text: content.to_string(),
                },
                true,
            );
        }
    }
    turns
}

#[cfg(test)]
mod tests {
    use super::*;
    use oleafly_agent::event::AgentEvent;

    fn record(turn_id: &str, text: &str) -> TurnRecord {
        let mut recorder = oleafly_agent::items::TurnRecorder::new(turn_id);
        recorder.record(&AgentEvent::TextDelta { text: text.into() });
        recorder.finish(false);
        recorder.into_record()
    }

    fn temp_root() -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let unique = NEXT.fetch_add(1, Ordering::Relaxed);
        let dir =
            std::env::temp_dir().join(format!("oleafly-rollout-{}-{unique}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn turns_append_and_replay_in_order() {
        let root = temp_root();
        append_turn(&root, "t1", &record("turn-1", "first")).unwrap();
        append_turn(&root, "t1", &record("turn-2", "second")).unwrap();

        let turns = read_turns(&root, "t1").unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(turns[0].turn_id, "turn-1");
        assert_eq!(turns[1].turn_id, "turn-2");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn thread_ids_are_sanitized_before_touching_the_filesystem() {
        assert!(rollout_path(Path::new("/tmp"), "../escape").is_err());
        assert!(rollout_path(Path::new("/tmp"), "").is_err());
        assert!(rollout_path(Path::new("/tmp"), "thread_ok-1").is_ok());
    }

    #[test]
    fn a_torn_trailing_line_is_skipped_but_mid_file_corruption_fails() {
        let root = temp_root();
        append_turn(&root, "t2", &record("turn-1", "first")).unwrap();
        let path = rollout_path(&root, "t2").unwrap();
        // Torn trailing write.
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"{\"turnId\":\"torn").unwrap();
        drop(file);
        assert_eq!(read_turns(&root, "t2").unwrap().len(), 1);

        // Corrupt middle line: prepend garbage by rewriting with two lines.
        let mut lines = fs::read_to_string(&path).unwrap();
        lines = "{\"corrupt\": true}\n".to_string() + &lines;
        fs::write(&path, lines).unwrap();
        assert!(read_turns(&root, "t2").is_err());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn appending_after_a_torn_write_heals_the_tail_and_keeps_replay_valid() {
        let root = temp_root();
        append_turn(&root, "t-heal", &record("turn-1", "first")).unwrap();
        let path = rollout_path(&root, "t-heal").unwrap();
        // Simulate a crash mid-append: a fragment with no closing newline.
        let mut file = OpenOptions::new().append(true).open(&path).unwrap();
        file.write_all(b"{\"turnId\":\"torn").unwrap();
        drop(file);

        // The next append must heal the fragment rather than fuse onto it.
        append_turn(&root, "t-heal", &record("turn-2", "second")).unwrap();
        // A further append proves the healed line did not become permanent
        // mid-file corruption.
        append_turn(&root, "t-heal", &record("turn-3", "third")).unwrap();

        let turns = read_turns(&root, "t-heal").unwrap();
        let ids: Vec<&str> = turns.iter().map(|t| t.turn_id.as_str()).collect();
        assert_eq!(ids, ["turn-1", "turn-2", "turn-3"]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn healing_a_fully_torn_file_starts_a_clean_rollout() {
        let root = temp_root();
        let path = rollout_path(&root, "t-allbad").unwrap();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        // A file that never completed a single record (no newline at all).
        fs::write(&path, b"{\"turnId\":\"never-closed").unwrap();

        append_turn(&root, "t-allbad", &record("turn-1", "first")).unwrap();
        let turns = read_turns(&root, "t-allbad").unwrap();
        assert_eq!(turns.len(), 1);
        assert_eq!(turns[0].turn_id, "turn-1");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn rollback_drops_the_tail_and_fork_copies_a_prefix() {
        let root = temp_root();
        for n in 1..=3 {
            append_turn(&root, "t3", &record(&format!("turn-{n}"), "x")).unwrap();
        }
        let turns = rollback_turns(&root, "t3", 1).unwrap();
        assert_eq!(turns.len(), 2);
        assert_eq!(
            read_turns(&root, "t3").unwrap().last().unwrap().turn_id,
            "turn-2"
        );

        let forked = fork_turns(&root, "t3", "t3-fork", 1).unwrap();
        assert_eq!(forked.len(), 1);
        assert_eq!(read_turns(&root, "t3-fork").unwrap()[0].turn_id, "turn-1");
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn archive_moves_and_delete_removes_everywhere() {
        let root = temp_root();
        append_turn(&root, "t4", &record("turn-1", "x")).unwrap();
        assert!(archive(&root, "t4").unwrap());
        assert!(!rollout_path(&root, "t4").unwrap().exists());
        assert!(archive_path_under(&root, "t4").exists());
        // Archiving again finds nothing and is fine.
        assert!(!archive(&root, "t4").unwrap());

        delete(&root, "t4").unwrap();
        assert!(!archive_path_under(&root, "t4").exists());
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn delete_rejects_thread_ids_that_escape_the_rollouts_directory() {
        let root = temp_root();
        fs::create_dir_all(root.join("sessions/rollout-x")).unwrap();
        let victim = root.parent().unwrap().join(format!(
            "oleafly-rollout-victim-{}.jsonl",
            std::process::id()
        ));
        fs::write(&victim, b"keep").unwrap();
        let victim_stem = victim.file_stem().unwrap().to_string_lossy();

        let result = delete(&root, &format!("x/../../../{victim_stem}"));

        assert!(result.is_err());
        assert_eq!(fs::read(&victim).unwrap(), b"keep");
        let _ = fs::remove_file(victim);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn legacy_chats_migrate_into_turn_records() {
        let chat = serde_json::json!({
            "id": "chat-1",
            "title": "Bib fixes",
            "messages": [
                {"role": "user", "content": "fix my bibfile"},
                {"role": "assistant", "content": "Fixed.",
                 "reasoningBlocks": [
                    {"text": "checking the entry", "beforeTool": 0},
                    {"text": "verifying", "beforeTool": 1}
                 ],
                 "toolCalls": [
                    {"name": "read_file", "output": "entry contents"},
                    {"name": "write_file", "output": "written", "approval": "approved"}
                 ]}
            ]
        });
        let turns = turns_from_legacy_chat(&chat);
        assert_eq!(turns.len(), 1);
        let items: Vec<&oleafly_agent::items::ThreadItem> =
            turns[0].items.iter().map(|r| &r.item).collect();
        // user, reasoning, tool, reasoning, tool, message
        assert!(
            matches!(items[0], oleafly_agent::items::ThreadItem::UserMessage { text } if text == "fix my bibfile")
        );
        assert!(matches!(
            items[1],
            oleafly_agent::items::ThreadItem::Reasoning { .. }
        ));
        assert!(
            matches!(&items[2], oleafly_agent::items::ThreadItem::DynamicToolCall { tool, status, .. }
            if tool == "read_file" && *status == oleafly_agent::items::ExecutionStatus::Completed)
        );
        assert!(matches!(
            items[3],
            oleafly_agent::items::ThreadItem::Reasoning { .. }
        ));
        assert!(
            matches!(&items[4], oleafly_agent::items::ThreadItem::FileChange { status, .. }
            if *status == oleafly_agent::items::ExecutionStatus::Completed)
        );
        assert!(
            matches!(items[5], oleafly_agent::items::ThreadItem::AgentMessage { text } if text == "Fixed.")
        );
    }

    #[test]
    fn a_rejected_legacy_tool_records_as_declined() {
        let chat = serde_json::json!({
            "messages": [
                {"role": "user", "content": "delete it"},
                {"role": "assistant", "content": "Kept it.",
                 "toolCalls": [{"name": "delete_file", "output": "", "approval": "rejected"}]}
            ]
        });
        let turns = turns_from_legacy_chat(&chat);
        match &turns[0].items[1].item {
            oleafly_agent::items::ThreadItem::FileChange { status, .. } => {
                assert_eq!(*status, oleafly_agent::items::ExecutionStatus::Declined);
            }
            other => panic!("expected a file change, got {other:?}"),
        }
    }

    #[test]
    fn listing_surfaces_thread_ids_only() {
        let root = temp_root();
        append_turn(&root, "b", &record("turn-1", "x")).unwrap();
        append_turn(&root, "a", &record("turn-1", "x")).unwrap();
        fs::write(root.join("sessions").join("not-a-rollout.txt"), "x").unwrap();
        assert_eq!(list_threads(&root).unwrap().len(), 2);
        let _ = fs::remove_dir_all(&root);
    }
}
