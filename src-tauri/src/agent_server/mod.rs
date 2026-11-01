pub mod protocol;
pub mod requests;
pub mod scheduler;

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use requests::{ResolvedRequest, ServerRequestRegistry};
use scheduler::SchedulerState;

pub const PREWARM_TTL: Duration = Duration::from_secs(10 * 60);

struct PrewarmedThread {
    thread_id: String,
    warmed_at: Instant,
}

#[derive(Default)]
struct PrewarmRegistry {
    by_project: HashMap<String, Vec<PrewarmedThread>>,
}

const MAX_PREWARMED_PER_PROJECT: usize = 8;

impl PrewarmRegistry {
    fn warm(&mut self, thread_id: String, project_id: &str) {
        let now = Instant::now();
        self.sweep(now, PREWARM_TTL);
        let entries = self.by_project.entry(project_id.to_string()).or_default();
        entries.push(PrewarmedThread {
            thread_id,
            warmed_at: now,
        });
        while entries.len() > MAX_PREWARMED_PER_PROJECT {
            entries.remove(0);
        }
    }

    fn sweep(&mut self, now: Instant, ttl: Duration) {
        self.by_project
            .values_mut()
            .for_each(|entries| entries.retain(|entry| now.duration_since(entry.warmed_at) <= ttl));
        self.by_project.retain(|_, entries| !entries.is_empty());
    }

    fn claim(&mut self, project_id: &str, now: Instant, ttl: Duration) -> Option<String> {
        self.sweep(now, ttl);
        let entries = self.by_project.get_mut(project_id)?;
        if entries.is_empty() {
            return None;
        }
        Some(entries.remove(0).thread_id)
    }
}

pub struct AgentServerState {
    pub requests: Arc<ServerRequestRegistry>,
    pub scheduler: Mutex<SchedulerState>,
    prewarmed: Mutex<PrewarmRegistry>,
    client_capabilities: Mutex<Option<protocol::ClientCapabilities>>,
}

impl Default for AgentServerState {
    fn default() -> Self {
        Self {
            requests: Arc::new(ServerRequestRegistry::default()),
            scheduler: Mutex::new(SchedulerState::default()),
            prewarmed: Mutex::new(PrewarmRegistry::default()),
            client_capabilities: Mutex::new(None),
        }
    }
}

fn lock_or_recover<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[tauri::command]
pub fn agent_server_initialize(
    state: tauri::State<'_, AgentServerState>,
    client_info: protocol::ClientInfo,
    capabilities: protocol::ClientCapabilities,
) -> Result<protocol::AgentServerInfo, String> {
    if client_info.name.trim().is_empty() {
        return Err("clientInfo.name must not be empty".into());
    }
    *lock_or_recover(&state.client_capabilities) = Some(capabilities);
    Ok(protocol::AgentServerInfo::current())
}

#[tauri::command]
pub fn agent_server_resolve_request(
    state: tauri::State<'_, AgentServerState>,
    request_id: String,
    decision: protocol::RequestDecision,
    payload: Option<serde_json::Value>,
) -> Result<(), String> {
    let resolved = state
        .requests
        .resolve(&request_id, ResolvedRequest { decision, payload });
    if resolved {
        Ok(())
    } else {
        Err(format!("no pending server request {request_id}"))
    }
}

#[tauri::command]
pub fn agent_server_abandon_request(
    state: tauri::State<'_, AgentServerState>,
    request_id: String,
) -> Result<(), String> {
    if state.requests.abandon(&request_id) {
        Ok(())
    } else {
        Err(format!("no pending server request {request_id}"))
    }
}

pub fn register_server_request(
    state: &AgentServerState,
    request: &protocol::ServerRequest,
    auto_resolution_ms: Option<u64>,
) -> (String, tokio::sync::oneshot::Receiver<ResolvedRequest>) {
    if request.auto_resolves_to_decline() {
        let delay = std::time::Duration::from_millis(requests::clamped_auto_resolution_ms(
            auto_resolution_ms,
        ));
        state.requests.register_with_auto_decline(request, delay)
    } else {
        state.requests.register(request)
    }
}

fn sessions_root() -> Result<std::path::PathBuf, String> {
    crate::paths::oleafly_root()
}

fn new_thread_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("thread-{nanos:x}-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

#[tauri::command]
pub async fn agent_thread_list(
    include_archived: Option<bool>,
) -> Result<Vec<crate::library_db::ThreadSummary>, String> {
    let include_archived = include_archived.unwrap_or(false);
    off_thread(move |root| crate::library_db::thread_summaries(&root, include_archived)).await
}

#[tauri::command]
pub async fn agent_thread_read(
    thread_id: String,
) -> Result<Vec<oleafly_agent::items::TurnRecord>, String> {
    off_thread(move |root| crate::rollout::read_turns(&root, &thread_id)).await
}

#[tauri::command]
pub async fn agent_thread_search(
    query: String,
    limit: Option<u32>,
) -> Result<Vec<crate::library_db::ThreadSearchHit>, String> {
    let limit = limit.unwrap_or(30).clamp(1, 100);
    off_thread(move |root| crate::library_db::search_threads(&root, &query, limit)).await
}

#[tauri::command]
pub async fn agent_thread_rollback(
    thread_id: String,
    num_turns: Option<u32>,
) -> Result<Vec<oleafly_agent::items::TurnRecord>, String> {
    let num_turns = usize::try_from(num_turns.unwrap_or(1)).unwrap_or(1);
    off_thread(move |root| {
        let turns = crate::rollout::rollback_turns(&root, &thread_id, num_turns)?;
        let _ = crate::library_db::resync_thread(&root, &thread_id, "", &turns);
        Ok(turns)
    })
    .await
}

#[tauri::command]
pub async fn agent_thread_fork(
    thread_id: String,
    exclude_turns: Option<u32>,
    project_id: Option<String>,
) -> Result<String, String> {
    let exclude_turns = usize::try_from(exclude_turns.unwrap_or(0)).unwrap_or(0);
    let new_id = new_thread_id();
    off_thread(move |root| {
        let turns = crate::rollout::fork_turns(&root, &thread_id, &new_id, exclude_turns)?;
        let _ = crate::library_db::resync_thread(
            &root,
            &new_id,
            project_id.as_deref().unwrap_or(""),
            &turns,
        );
        Ok(new_id)
    })
    .await
}

#[tauri::command]
pub async fn agent_thread_archive(thread_id: String) -> Result<bool, String> {
    off_thread(move |root| {
        let archived = crate::rollout::archive(&root, &thread_id)?;
        if archived {
            let _ = crate::library_db::archive_thread(&root, &thread_id);
        }
        Ok(archived)
    })
    .await
}

#[tauri::command]
pub async fn agent_thread_delete(thread_id: String) -> Result<(), String> {
    off_thread(move |root| {
        crate::rollout::delete(&root, &thread_id)?;
        let _ = crate::library_db::drop_thread(&root, &thread_id);
        Ok(())
    })
    .await
}

#[tauri::command]
pub fn agent_thread_prewarm(
    state: tauri::State<'_, AgentServerState>,
    project_id: String,
) -> Result<String, String> {
    let thread_id = new_thread_id();
    lock_or_recover(&state.prewarmed).warm(thread_id.clone(), &project_id);
    Ok(thread_id)
}

#[tauri::command]
pub fn agent_thread_claim_prewarmed(
    state: tauri::State<'_, AgentServerState>,
    project_id: String,
) -> Result<Option<String>, String> {
    Ok(lock_or_recover(&state.prewarmed).claim(&project_id, Instant::now(), PREWARM_TTL))
}

#[tauri::command]
pub async fn agent_thread_import_chat(
    project_id: String,
    chat_id: String,
) -> Result<String, String> {
    crate::paths::validate_project_id(&project_id)?;
    let thread_id = new_thread_id();
    off_thread(move |root| {
        let _ = crate::chats::migrate_legacy_chats(&root, &project_id);
        let chat = crate::chats::read_chat(&root, &project_id, &chat_id)?;
        import_chat_into_thread(
            &root,
            &format!("[{chat}]"),
            &project_id,
            &chat_id,
            &thread_id,
        )?;
        Ok(thread_id)
    })
    .await
}

fn import_chat_into_thread(
    root: &std::path::Path,
    chats_json: &str,
    project_id: &str,
    chat_id: &str,
    thread_id: &str,
) -> Result<(), String> {
    let chats: serde_json::Value =
        serde_json::from_str(chats_json).map_err(|e| format!("chats json invalid: {e}"))?;
    let chat = chats
        .as_array()
        .and_then(|list| {
            list.iter()
                .find(|chat| chat.get("id").and_then(|v| v.as_str()) == Some(chat_id))
        })
        .ok_or_else(|| format!("chat {chat_id} was not found in this project"))?;
    let turns = crate::rollout::turns_from_legacy_chat(chat);
    for turn in &turns {
        crate::rollout::append_turn(root, thread_id, turn)?;
    }
    crate::library_db::resync_thread(root, thread_id, project_id, &turns)?;
    Ok(())
}

async fn off_thread<T: Send + 'static>(
    work: impl FnOnce(std::path::PathBuf) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let root = sessions_root()?;
    tauri::async_runtime::spawn_blocking(move || work(root))
        .await
        .map_err(|e| format!("thread store task failed: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn import_temp_root(tag: &str) -> std::path::PathBuf {
        let root =
            std::env::temp_dir().join(format!("oleafly-import-chat-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn importing_a_legacy_chat_writes_a_replayable_rollout() {
        let root = import_temp_root("happy");
        let chats = serde_json::json!([
            {"id": "chat-1", "title": "Bib", "messages": [
                {"role": "user", "content": "fix my bib"},
                {"role": "assistant", "content": "Done."}
            ]},
            {"id": "chat-2", "messages": [
                {"role": "user", "content": "other chat"}
            ]}
        ])
        .to_string();

        import_chat_into_thread(&root, &chats, "proj", "chat-1", "thread-import-1").unwrap();

        let turns = crate::rollout::read_turns(&root, "thread-import-1").unwrap();
        assert_eq!(turns.len(), 1);
        let joined = serde_json::to_string(&turns[0].items).unwrap();
        assert!(joined.contains("fix my bib"));
        assert!(joined.contains("Done."));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn importing_a_missing_chat_is_an_error_and_writes_nothing() {
        let root = import_temp_root("missing");
        let chats = serde_json::json!([{"id": "chat-1", "messages": []}]).to_string();

        let result =
            import_chat_into_thread(&root, &chats, "proj", "nope", "thread-import-missing");

        assert!(result.unwrap_err().contains("was not found"));
        assert!(crate::rollout::read_turns(&root, "thread-import-missing").is_err());
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn importing_invalid_chats_json_is_an_error() {
        let root = import_temp_root("badjson");
        let result =
            import_chat_into_thread(&root, "{ not json", "proj", "chat-1", "thread-import-bad");
        assert!(result.unwrap_err().contains("chats json invalid"));
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn prewarmed_threads_are_claimed_once_and_expire() {
        let mut registry = PrewarmRegistry::default();
        registry.warm("thread-a".into(), "proj");
        registry.warm("thread-b".into(), "proj");
        registry.warm("thread-c".into(), "other");

        let now = Instant::now();
        assert_eq!(
            registry.claim("proj", now, PREWARM_TTL),
            Some("thread-a".into())
        );
        assert_eq!(
            registry.claim("other", now, PREWARM_TTL),
            Some("thread-c".into())
        );
        assert_eq!(
            registry.claim("proj", now, PREWARM_TTL),
            Some("thread-b".into())
        );
        assert_eq!(registry.claim("proj", now, PREWARM_TTL), None);

        registry.warm("thread-late".into(), "proj");
        let later = now + PREWARM_TTL + Duration::from_secs(1);
        assert_eq!(registry.claim("proj", later, PREWARM_TTL), None);
    }

    #[tokio::test]
    async fn elicitation_registrations_auto_decline_but_approvals_wait() {
        let state = AgentServerState::default();
        let elicitation = protocol::ServerRequest::McpElicitation(protocol::McpElicitationParams {
            request_id: String::new(),
            thread_id: "t1".into(),
            server_name: "docs".into(),
            elicitation: serde_json::Value::Null,
        });
        let (id, receiver) = register_server_request(&state, &elicitation, None);
        assert!(id.starts_with("req-"));
        assert!(state.requests.resolve(
            &id,
            ResolvedRequest {
                decision: protocol::RequestDecision::Accept,
                payload: None,
            },
        ));
        assert_eq!(
            receiver.await.unwrap().decision,
            protocol::RequestDecision::Accept
        );

        let approval = protocol::ServerRequest::CommandExecutionApproval(
            protocol::CommandExecutionApprovalParams {
                request_id: String::new(),
                thread_id: "t1".into(),
                turn_id: "turn-1".into(),
                item_id: "i1".into(),
                command: vec!["rm".into(), "-rf".into(), "build".into()],
                cwd: "/tmp".into(),
                reason: "destructive command".into(),
            },
        );
        let (_id, receiver) = register_server_request(&state, &approval, None);
        drop(receiver);
        assert_eq!(state.requests.pending_count(), 1);
    }
}
