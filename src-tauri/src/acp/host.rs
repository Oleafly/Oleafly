//! The app's [`ClientHost`]: what an agent sends, applied to its live
//! session in wire order.
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, Weak};

use oleafly_acp::{ClientHost, IncomingRequest};
use serde_json::Value;

use super::runtime::{AcpRuntime, LiveSession};

fn shows_auth_status(params: &Value) -> bool {
    let status = if params["authStatus"].is_object() {
        &params["authStatus"]
    } else {
        params
    };
    status["kind"] != "none"
}

pub(super) struct SessionHost {
    runtime: Weak<AcpRuntime>,
    session: OnceLock<Weak<LiveSession>>,
    /// Set after a protocol error: later messages are ignored, as the old
    /// reader stopped reading.
    failed: AtomicBool,
}

impl SessionHost {
    pub(super) fn new(runtime: &Arc<AcpRuntime>) -> Arc<Self> {
        Arc::new(Self {
            runtime: Arc::downgrade(runtime),
            session: OnceLock::new(),
            failed: AtomicBool::new(false),
        })
    }

    /// Connects the host to its session once the session exists.
    pub(super) fn bind(&self, session: &Arc<LiveSession>) {
        let _ = self.session.set(Arc::downgrade(session));
    }

    fn parts(&self) -> Option<(Arc<AcpRuntime>, Arc<LiveSession>)> {
        let runtime = self.runtime.upgrade()?;
        let session = self.session.get()?.upgrade()?;
        Some((runtime, session))
    }

    fn fail(&self, runtime: &AcpRuntime, session: &LiveSession, error: &str) {
        self.failed.store(true, Ordering::Release);
        let _ = runtime.fail(session, error);
        session.client.request_stop();
    }
}

impl ClientHost for SessionHost {
    fn on_update(&self, params: Value) {
        if self.failed.load(Ordering::Acquire) {
            return;
        }
        let Some((runtime, session)) = self.parts() else {
            return;
        };
        if let Err(error) = runtime.handle_update(&session, &params) {
            self.fail(&runtime, &session, &error);
        }
    }

    fn on_turn_ended(&self, session_id: &str) {
        let Some((_, session)) = self.parts() else {
            return;
        };
        if let Ok(mut state) = session.state.lock() {
            if state.record.native_session_id.as_deref() == Some(session_id) {
                state.turn_closed = true;
            }
        };
    }

    fn on_request(&self, request: IncomingRequest) {
        let parts = self.parts();
        let Some((runtime, session)) = parts.filter(|_| !self.failed.load(Ordering::Acquire))
        else {
            if request.method() == "session/request_permission" {
                let _ = request.respond(serde_json::json!({"outcome": {"outcome": "cancelled"}}));
            } else {
                let _ = request.reject(-32603, "The ACP session is unavailable.");
            }
            return;
        };
        let result = match request.method() {
            "session/request_permission" => runtime.permission_requested(&session, request),
            "fs/read_text_file" => runtime.read_text_file(&session, request),
            oleafly_acp::elicitation::ELICITATION_CREATE => {
                runtime.elicitation_requested(&session, request)
            }
            _ => request
                .reject(-32601, "This client capability is not available.")
                .map_err(|error| error.to_string()),
        };
        if let Err(error) = result {
            self.fail(&runtime, &session, &error);
        }
    }

    fn on_notification(&self, method: &str, params: Value) {
        if self.failed.load(Ordering::Acquire) {
            return;
        }
        let Some((runtime, session)) = self.parts() else {
            return;
        };
        match method {
            oleafly_acp::elicitation::ELICITATION_COMPLETE => {
                runtime.elicitation_completed(&session, &params);
            }
            "_auth/status_update" if shows_auth_status(&params) => {
                runtime.auth_status_update(&session, &params);
            }
            _ => {}
        }
    }

    fn on_dropped_update(&self, bytes: usize) {
        if let Some((runtime, session)) = self.parts() {
            runtime.note_dropped_update(&session, bytes);
        }
    }

    fn on_disconnected(&self) {
        let Some((runtime, session)) = self.parts() else {
            return;
        };
        runtime.session_disconnected(&session);
    }
}
