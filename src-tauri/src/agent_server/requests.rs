//! Registry for server-initiated requests: the agent asks the shell to
//! resolve an approval, user-input form, or MCP elicitation, and the turn
//! pauses until the shell answers (or the request auto-resolves).

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::oneshot;

use super::protocol::{RequestDecision, ServerRequest};

/// Elicitations auto-decline after this much foreground inactivity.
pub const FOREGROUND_INACTIVITY_AUTO_DECLINE_MS: u64 = 60_000;
/// Clamps for a client-supplied auto-resolution window.
pub const MIN_AUTO_RESOLUTION_MS: u64 = 5_000;
pub const MAX_AUTO_RESOLUTION_MS: u64 = 300_000;

pub fn clamped_auto_resolution_ms(requested_ms: Option<u64>) -> u64 {
    requested_ms
        .unwrap_or(FOREGROUND_INACTIVITY_AUTO_DECLINE_MS)
        .clamp(MIN_AUTO_RESOLUTION_MS, MAX_AUTO_RESOLUTION_MS)
}

#[derive(Debug)]
pub struct ResolvedRequest {
    pub decision: RequestDecision,
    pub payload: Option<serde_json::Value>,
}

struct PendingEntry {
    method: &'static str,
    sender: oneshot::Sender<ResolvedRequest>,
}

#[derive(Default)]
pub struct ServerRequestRegistry {
    pending: Mutex<HashMap<String, PendingEntry>>,
}

impl ServerRequestRegistry {
    /// Register a request that waits for the shell's decision indefinitely.
    pub fn register(
        &self,
        request: &ServerRequest,
    ) -> (String, oneshot::Receiver<ResolvedRequest>) {
        let (sender, receiver) = oneshot::channel();
        let request_id = next_request_id();
        {
            let mut pending = lock(&self.pending);
            pending.insert(
                request_id.clone(),
                PendingEntry {
                    method: request.method(),
                    sender,
                },
            );
        }
        (request_id, receiver)
    }

    /// Register a request that auto-declines after `delay` so an abandoned
    /// prompt cannot wedge a turn forever. The task is spawned onto whatever
    /// runtime is current (the agent-server command runtime in production).
    pub fn register_with_auto_decline(
        self: &Arc<Self>,
        request: &ServerRequest,
        delay: Duration,
    ) -> (String, oneshot::Receiver<ResolvedRequest>) {
        let (request_id, receiver) = self.register(request);
        let registry = Arc::clone(self);
        let id = request_id.clone();
        tokio::spawn(async move {
            tokio::time::sleep(delay).await;
            registry.resolve_with(
                &id,
                ResolvedRequest {
                    decision: RequestDecision::Decline,
                    payload: None,
                },
            );
        });
        (request_id, receiver)
    }

    /// Resolve a pending request from the shell. Returns false when nothing
    /// was pending (already resolved, auto-declined, or abandoned).
    pub fn resolve(&self, request_id: &str, resolution: ResolvedRequest) -> bool {
        self.resolve_with(request_id, resolution)
    }

    fn resolve_with(&self, request_id: &str, resolution: ResolvedRequest) -> bool {
        let entry = lock(&self.pending).remove(request_id);
        match entry {
            Some(entry) => entry.sender.send(resolution).is_ok(),
            None => false,
        }
    }

    /// Drop a pending request without a decision (the waiter receives a
    /// closed-channel error and treats it as abandoned).
    pub fn abandon(&self, request_id: &str) -> bool {
        lock(&self.pending).remove(request_id).is_some()
    }

    pub fn pending_count(&self) -> usize {
        lock(&self.pending).len()
    }
}

fn lock(
    pending: &Mutex<HashMap<String, PendingEntry>>,
) -> std::sync::MutexGuard<'_, HashMap<String, PendingEntry>> {
    pending
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn next_request_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(1);
    format!("req-{}", NEXT.fetch_add(1, Ordering::Relaxed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agent_server::protocol::McpElicitationParams;

    fn elicitation() -> ServerRequest {
        ServerRequest::McpElicitation(McpElicitationParams {
            request_id: String::new(),
            thread_id: "t1".into(),
            server_name: "docs".into(),
            elicitation: serde_json::Value::Null,
        })
    }

    #[test]
    fn auto_resolution_window_clamps() {
        assert_eq!(clamped_auto_resolution_ms(None), 60_000);
        assert_eq!(clamped_auto_resolution_ms(Some(1)), 5_000);
        assert_eq!(clamped_auto_resolution_ms(Some(10_000)), 10_000);
        assert_eq!(clamped_auto_resolution_ms(Some(600_000)), 300_000);
    }

    #[tokio::test]
    async fn shell_resolution_reaches_the_waiter() {
        let registry = Arc::new(ServerRequestRegistry::default());
        let (request_id, receiver) = registry.register(&elicitation());
        assert_eq!(registry.pending_count(), 1);
        assert!(registry.resolve(
            &request_id,
            ResolvedRequest {
                decision: RequestDecision::AcceptForSession,
                payload: None,
            },
        ));
        let resolved = receiver.await.unwrap();
        assert_eq!(resolved.decision, RequestDecision::AcceptForSession);
        assert_eq!(registry.pending_count(), 0);
    }

    #[tokio::test]
    async fn auto_decline_fires_when_the_shell_stays_silent() {
        let registry = Arc::new(ServerRequestRegistry::default());
        let (request_id, receiver) =
            registry.register_with_auto_decline(&elicitation(), Duration::from_millis(1));
        let resolved = receiver.await.unwrap();
        assert_eq!(resolved.decision, RequestDecision::Decline);
        // A late shell decision finds nothing pending.
        assert!(!registry.resolve(
            &request_id,
            ResolvedRequest {
                decision: RequestDecision::Accept,
                payload: None,
            },
        ));
    }

    #[tokio::test]
    async fn abandon_closes_the_channel() {
        let registry = Arc::new(ServerRequestRegistry::default());
        let (request_id, receiver) = registry.register(&elicitation());
        assert!(registry.abandon(&request_id));
        assert!(receiver.await.is_err());
    }
}
