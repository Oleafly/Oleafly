//! 0.4.8 L: a built-in task's conversation, saved when the task moves to
//! another process at a step boundary, so the next owner continues the same
//! conversation instead of starting over from the research record.
//!
//! The snapshot sits beside the task's workspaces:
//! `<tasks root>/workspaces/<task>/<generation>-conversation.json`. It is
//! bounded (48 MiB): old images go first, then the middle of the
//! conversation. A snapshot that cannot be read, or belongs to another task,
//! generation, provider or model, is refused; the next owner then resumes
//! from the research record.
use std::path::{Path, PathBuf};

use oleafly_agent::{ContentPart, Message, Role};
use serde::{Deserialize, Serialize};

/// The snapshot schema this version writes and reads.
pub const CONVERSATION_VERSION: u32 = 1;
/// The largest snapshot written.
pub const MAX_CONVERSATION_BYTES: usize = 48 << 20;
/// Messages kept from the end when the middle of a conversation is cut.
const KEEP_LAST_MESSAGES: usize = 8;
const IMAGE_LEFT_OUT: &str = "[image left out of the saved conversation]";
const MIDDLE_LEFT_OUT: &str =
    "[Earlier messages were left out of the saved conversation. Read the research record for what happened.]";

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSnapshot {
    pub version: u32,
    pub task_id: String,
    /// The generation that saved it.
    pub generation: u64,
    pub provider_id: String,
    pub model_id: String,
    pub messages: Vec<Message>,
    /// The task was waiting for its runs when it was saved: the next owner
    /// waits again instead of calling the model.
    #[serde(default)]
    pub waiting_for_runs: bool,
    pub saved_at: i64,
}

/// `<gen>-conversation.json`.
pub fn conversation_file_name(generation: u64) -> String {
    format!("{generation}-conversation.json")
}

/// `<tasks root>/workspaces/<task>/<gen>-conversation.json`.
pub fn conversation_path(tasks_root: &Path, task_id: &str, generation: u64) -> PathBuf {
    crate::isolation::task_workspace_root(tasks_root, task_id)
        .join(conversation_file_name(generation))
}

fn valid_file_name(file: &str) -> bool {
    file.strip_suffix("-conversation.json")
        .is_some_and(|generation| {
            !generation.is_empty() && generation.bytes().all(|byte| byte.is_ascii_digit())
        })
}

/// Writes the snapshot (bounded) and returns its file name.
pub fn save(tasks_root: &Path, snapshot: &ConversationSnapshot) -> Result<String, String> {
    let bytes = encode_bounded(snapshot, MAX_CONVERSATION_BYTES);
    let folder = crate::isolation::task_workspace_root(tasks_root, &snapshot.task_id);
    std::fs::create_dir_all(&folder)
        .map_err(|error| format!("The conversation could not be saved: {error}"))?;
    let path = folder.join(conversation_file_name(snapshot.generation));
    oleafly_core::atomic::write_atomic(&path, &bytes)
        .map_err(|error| format!("The conversation could not be saved: {error}"))?;
    harden(&path);
    Ok(conversation_file_name(snapshot.generation))
}

/// Only the user can read a saved conversation (it holds file contents
/// and tool output).
fn harden(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(not(unix))]
    {
        // The data folder is inside the user's profile, which only they
        // can read.
        let _ = path;
    }
}

fn encode(snapshot: &ConversationSnapshot) -> Vec<u8> {
    serde_json::to_vec(snapshot).unwrap_or_default()
}

fn is_image(part: &ContentPart) -> bool {
    matches!(
        part,
        ContentPart::Image { .. } | ContentPart::Document { .. }
    )
}

/// Old images (all but the last two messages') become a short note.
fn drop_old_images(messages: &mut [Message]) {
    let keep_from = messages.len().saturating_sub(2);
    for message in &mut messages[..keep_from] {
        for part in &mut message.content {
            match part {
                ContentPart::ToolResult { images, .. } if !images.is_empty() => {
                    images.clear();
                }
                part if is_image(part) => *part = ContentPart::text(IMAGE_LEFT_OUT),
                _ => {}
            }
        }
    }
}

/// Keeps the first user message (with a note where the cut is) and the
/// last messages. The kept tail starts at a reply of the model, so turns
/// still alternate and every tool call keeps its result.
fn cut_middle(messages: Vec<Message>) -> Vec<Message> {
    if messages.len() <= KEEP_LAST_MESSAGES + 1 {
        return messages;
    }
    let mut start = messages.len() - KEEP_LAST_MESSAGES;
    while start < messages.len() && messages[start].role != Role::Assistant {
        start += 1;
    }
    if start >= messages.len() || start <= 1 {
        return messages;
    }
    let mut first = messages[0].clone();
    first.content.push(ContentPart::text(MIDDLE_LEFT_OUT));
    let mut kept = Vec::with_capacity(KEEP_LAST_MESSAGES + 1);
    kept.push(first);
    kept.extend(messages[start..].iter().cloned());
    kept
}

/// The snapshot as JSON within `cap` bytes: images in all but the last two
/// messages are left out first, then the middle of the conversation; a
/// conversation still too large is saved empty (it then fails to load and
/// the next owner resumes from the research record).
pub fn encode_bounded(snapshot: &ConversationSnapshot, cap: usize) -> Vec<u8> {
    let bytes = encode(snapshot);
    if bytes.len() <= cap {
        return bytes;
    }
    let mut smaller = snapshot.clone();
    drop_old_images(&mut smaller.messages);
    let bytes = encode(&smaller);
    if bytes.len() <= cap {
        return bytes;
    }
    smaller.messages = cut_middle(std::mem::take(&mut smaller.messages));
    let bytes = encode(&smaller);
    if bytes.len() <= cap {
        return bytes;
    }
    smaller.messages.clear();
    encode(&smaller)
}

/// Reads a snapshot the previous generation saved. It must be this task's,
/// from `generation`, for this provider and model, and not empty.
pub fn load(
    tasks_root: &Path,
    task_id: &str,
    file: &str,
    generation: u64,
    provider_id: &str,
    model_id: &str,
) -> Result<ConversationSnapshot, String> {
    if !valid_file_name(file) {
        return Err("The saved conversation has an unexpected name.".into());
    }
    let path = crate::isolation::task_workspace_root(tasks_root, task_id).join(file);
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "The saved conversation is missing.".to_string())?;
    if !metadata.is_file() || metadata.len() as usize > MAX_CONVERSATION_BYTES + 1024 * 1024 {
        return Err("The saved conversation is not a regular file of the expected size.".into());
    }
    let bytes = std::fs::read(&path)
        .map_err(|_| "The saved conversation could not be read.".to_string())?;
    let snapshot: ConversationSnapshot = serde_json::from_slice(&bytes)
        .map_err(|_| "The saved conversation is unreadable.".to_string())?;
    if snapshot.version != CONVERSATION_VERSION {
        return Err("The saved conversation is from another version of Oleafly.".into());
    }
    if snapshot.task_id != task_id || snapshot.generation != generation {
        return Err("The saved conversation belongs to another run.".into());
    }
    if snapshot.provider_id != provider_id || snapshot.model_id != model_id {
        return Err("The saved conversation was made with another model.".into());
    }
    if snapshot.messages.is_empty() {
        return Err("The saved conversation is empty.".into());
    }
    Ok(snapshot)
}

/// The model's last reply text, for a summary when the conversation ends
/// without another turn.
pub fn last_assistant_text(messages: &[Message]) -> String {
    messages
        .iter()
        .rev()
        .find(|message| message.role == Role::Assistant)
        .map(|message| {
            message
                .content
                .iter()
                .filter_map(|part| match part {
                    ContentPart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image_message(bytes: usize) -> Message {
        Message {
            role: Role::User,
            content: vec![
                ContentPart::text("figure"),
                ContentPart::Image {
                    image: format!("data:image/png;base64,{}", "A".repeat(bytes)),
                },
            ],
        }
    }

    fn snapshot(messages: Vec<Message>) -> ConversationSnapshot {
        ConversationSnapshot {
            version: CONVERSATION_VERSION,
            task_id: "task-1".into(),
            generation: 3,
            provider_id: "openai".into(),
            model_id: "gpt-6.1-sol".into(),
            messages,
            waiting_for_runs: false,
            saved_at: 1,
        }
    }

    fn with_images(count: usize, bytes: usize) -> ConversationSnapshot {
        let mut messages = vec![Message::user("start")];
        for index in 0..count {
            messages.push(Message {
                role: Role::Assistant,
                content: vec![ContentPart::text(format!("step {index}"))],
            });
            messages.push(image_message(bytes));
        }
        messages.push(Message {
            role: Role::Assistant,
            content: vec![ContentPart::text("last")],
        });
        snapshot(messages)
    }

    fn image_count(snapshot: &ConversationSnapshot) -> usize {
        snapshot
            .messages
            .iter()
            .flat_map(|message| &message.content)
            .filter(|part| matches!(part, ContentPart::Image { .. }))
            .count()
    }

    #[test]
    fn an_oversized_conversation_drops_old_images_first_then_middle_messages() {
        let original = with_images(10, 1 << 20);
        let bytes = encode_bounded(&original, 3 << 20);
        assert!(bytes.len() <= 3 << 20);
        let decoded: ConversationSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert!(image_count(&decoded) < 10);
        assert_eq!(decoded.messages.last(), original.messages.last());
        assert_eq!(decoded.messages.first(), original.messages.first());

        // Too large even without old images: the middle goes.
        let mut long = snapshot(vec![Message::user("start")]);
        for index in 0..200 {
            long.messages.push(Message {
                role: Role::Assistant,
                content: vec![ContentPart::text(format!(
                    "{index} {}",
                    "x".repeat(16 * 1024)
                ))],
            });
            long.messages.push(Message::user(format!("next {index}")));
        }
        let bytes = encode_bounded(&long, 512 * 1024);
        let decoded: ConversationSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert!(decoded.messages.len() <= KEEP_LAST_MESSAGES + 1);
        assert_eq!(decoded.messages[0].content[0], long.messages[0].content[0]);
        assert!(
            matches!(&decoded.messages[0].content[1], ContentPart::Text { text } if text == MIDDLE_LEFT_OUT)
        );
        assert_eq!(decoded.messages[1].role, Role::Assistant);
        assert_eq!(decoded.messages.last(), long.messages.last());
    }

    #[test]
    fn a_conversation_that_cannot_fit_is_saved_empty_and_refused_on_load() {
        let temp = tempfile::tempdir().unwrap();
        let huge = snapshot(vec![Message::user("x".repeat(64 * 1024))]);
        let bytes = encode_bounded(&huge, 1024);
        let decoded: ConversationSnapshot = serde_json::from_slice(&bytes).unwrap();
        assert!(decoded.messages.is_empty());
        let folder = crate::isolation::task_workspace_root(temp.path(), "task-1");
        std::fs::create_dir_all(&folder).unwrap();
        std::fs::write(folder.join("3-conversation.json"), bytes).unwrap();
        assert!(load(
            temp.path(),
            "task-1",
            "3-conversation.json",
            3,
            "openai",
            "gpt-6.1-sol"
        )
        .is_err());
    }

    #[test]
    fn a_saved_conversation_loads_back() {
        let temp = tempfile::tempdir().unwrap();
        let saved = snapshot(vec![Message::user("start")]);
        let file = save(temp.path(), &saved).unwrap();
        assert_eq!(file, "3-conversation.json");
        assert_eq!(
            load(temp.path(), "task-1", &file, 3, "openai", "gpt-6.1-sol").unwrap(),
            saved
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(conversation_path(temp.path(), "task-1", 3))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o777, 0o600);
        }
    }

    #[test]
    fn a_snapshot_of_another_task_model_or_version_is_refused() {
        let temp = tempfile::tempdir().unwrap();
        let file = save(temp.path(), &snapshot(vec![Message::user("start")])).unwrap();
        assert!(load(temp.path(), "task-2", &file, 3, "openai", "gpt-6.1-sol").is_err());
        assert!(load(temp.path(), "task-1", &file, 4, "openai", "gpt-6.1-sol").is_err());
        assert!(load(temp.path(), "task-1", &file, 3, "anthropic", "gpt-6.1-sol").is_err());
        assert!(load(temp.path(), "task-1", &file, 3, "openai", "other").is_err());
        assert!(load(
            temp.path(),
            "task-1",
            "../escape-conversation.json",
            3,
            "openai",
            "gpt-6.1-sol"
        )
        .is_err());
        let mut newer = snapshot(vec![Message::user("start")]);
        newer.version = CONVERSATION_VERSION + 1;
        std::fs::write(
            conversation_path(temp.path(), "task-1", 3),
            serde_json::to_vec(&newer).unwrap(),
        )
        .unwrap();
        assert!(load(temp.path(), "task-1", &file, 3, "openai", "gpt-6.1-sol").is_err());
    }

    #[test]
    fn conversation_files_live_beside_the_workspace() {
        assert_eq!(
            conversation_path(Path::new("/d/research-tasks"), "task-1", 3),
            Path::new("/d/research-tasks/workspaces/task-1/3-conversation.json")
        );
    }

    #[cfg(windows)]
    #[test]
    fn conversation_paths_work_under_a_non_ascii_profile() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp
            .path()
            .join("Zoë Müller")
            .join(".oleafly")
            .join("research-tasks");
        let file = save(&root, &snapshot(vec![Message::user("start")])).unwrap();
        assert!(load(&root, "task-1", &file, 3, "openai", "gpt-6.1-sol").is_ok());
        assert!(conversation_path(&root, "task-1", 3)
            .to_string_lossy()
            .contains("Zoë Müller"));
    }

    #[test]
    fn the_last_reply_is_the_summary_of_a_resumed_wait() {
        let messages = vec![
            Message::user("start"),
            Message {
                role: Role::Assistant,
                content: vec![ContentPart::text("Started r001.")],
            },
        ];
        assert_eq!(last_assistant_text(&messages), "Started r001.");
    }
}
