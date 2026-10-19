//! Signing in to an agent (in Oleafly, with an API key, or in a terminal),
//! signing out, and the questions an agent asks the user (forms and links).
use oleafly_acp::elicitation::{self, ElicitationView, ELICITATION_TTL_MS};
use oleafly_acp::limits::{AUTH_ELICITATION_TIMEOUT, AUTH_TIMEOUT};
use oleafly_acp::IncomingRequest;
use serde_json::{json, Map, Value};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;
use zeroize::Zeroizing;

use super::catalog;
use super::runtime::{AcpRuntime, LiveSession, PendingElicitation};
use super::types::{now_ms, SessionSnapshot, SessionStatus, TerminalSignIn};

const MAX_PENDING_QUESTIONS: usize = 4;
const MAX_ENV: usize = 32;
const MAX_ENV_VALUE: usize = 8 * 1024;

fn env_name_ok(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 128
        && chars
            .next()
            .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && chars.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

impl AcpRuntime {
    /// Signs in with `method_id`. API-key methods take the key, which is
    /// added to the session's redactor before anything is sent. The request
    /// may take 180 s, or 15 minutes once the agent asks the user something.
    pub async fn authenticate(
        self: &Arc<Self>,
        id: &str,
        method_id: &str,
        api_key: Option<Zeroizing<String>>,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "This ACP session is busy.")?;
        let record = self.copy_record(&session)?;
        let method = record
            .auth_methods
            .iter()
            .find(|method| method.id == method_id)
            .cloned();
        let Some(method) = method.filter(|_| record.status == SessionStatus::AuthRequired) else {
            return Err("This sign-in method is no longer available.".into());
        };
        let meta = match &method.api_key_provider {
            Some(_) => {
                let key = api_key
                    .as_ref()
                    .map(|key| key.trim())
                    .filter(|key| !key.is_empty())
                    .ok_or("Enter the API key for this agent.")?;
                session.redactor.add_secret(key);
                Some(json!({"api-key": {"apiKey": key}}))
            }
            None => None,
        };
        session.authenticating.store(true, Ordering::Release);
        session.auth_asked.send_replace(false);
        let mut asked = session.auth_asked.subscribe();
        let request = session
            .client
            .authenticate(method_id, meta, AUTH_ELICITATION_TIMEOUT);
        tokio::pin!(request);
        let timer = tokio::time::sleep(AUTH_TIMEOUT);
        tokio::pin!(timer);
        let mut armed = true;
        let mut watching = true;
        let result = loop {
            tokio::select! {
                result = &mut request => break result.map(|_| ()),
                _ = &mut timer, if armed => {
                    session.client.request_stop();
                    break Err(oleafly_acp::RpcError::local("Sign-in did not finish within 3 minutes."));
                }
                changed = asked.changed(), if watching => {
                    match changed {
                        Ok(()) if *asked.borrow() => armed = false,
                        Ok(()) => {}
                        Err(_) => watching = false,
                    }
                }
            }
        };
        session.authenticating.store(false, Ordering::Release);
        if let Err(error) = result {
            let message = session
                .redactor
                .text(&format!("Sign-in did not complete. {}", error.message));
            if let Ok(mut state) = session.state.lock() {
                state.record.error = Some(message.clone());
                let _ = self.emit_locked(
                    &session,
                    &mut state,
                    "status",
                    json!({"status": "auth_required", "error": message}),
                );
            }
            if session.client.is_closed() {
                session.client.shutdown().await;
                self.release_live(&session).await;
            }
            return Err(message);
        }
        if let Err(error) = self.establish(&session).await {
            let _ = self.fail(&session, &error);
            session.client.shutdown().await;
            self.release_live(&session).await;
            return Err(session.redactor.text(&error));
        }
        self.snapshot(id).await
    }

    /// The terminal command that signs in to an agent: the agent's own
    /// sign-in command when it names one, else the agent's launch with the
    /// method's arguments. Never carries `PATH` or secrets.
    pub async fn sign_in_command(
        &self,
        agent_id: &str,
        session_id: Option<&str>,
        method_id: &str,
    ) -> Result<TerminalSignIn, String> {
        let definition = self.definition(agent_id)?;
        let methods = match session_id {
            Some(id) => match self.get_live(id).await {
                Ok(session) => self.copy_record(&session)?.auth_methods,
                Err(_) => self.store.get(id)?.auth_methods,
            },
            None => self
                .store
                .agent_runtime(agent_id)?
                .map(|info| info.auth_methods)
                .unwrap_or_default(),
        };
        let method = methods
            .into_iter()
            .find(|method| method.id == method_id)
            .ok_or("This sign-in method is no longer available.")?;
        let program = self.store.agent_program(agent_id)?;
        let launch = {
            let root = self.root.clone();
            let definition = definition.clone();
            catalog::blocking(move || {
                catalog::plan(&root, &definition, program.as_deref().map(Path::new)).launch
            })
            .await??
        };
        let own = method.terminal_command.as_ref().filter(|command| {
            Path::new(&command.command).is_absolute() && Path::new(&command.command).is_file()
        });
        let (program, args) = match own {
            Some(command) => (command.command.clone(), command.args.clone()),
            None => {
                let mut args = launch.args.clone();
                args.extend(method.args.iter().cloned());
                (launch.executable.to_string_lossy().into_owned(), args)
            }
        };
        let mut env = BTreeMap::new();
        for (name, value) in &launch.env {
            if name.eq_ignore_ascii_case("PATH") {
                continue;
            }
            let value = value
                .clone()
                .into_string()
                .map_err(|_| "This agent's environment cannot be shown in a terminal.")?;
            env.insert(name.clone(), value);
        }
        for (name, value) in &method.env {
            env.insert(name.clone(), value.clone());
        }
        env.retain(|name, value| {
            !name.eq_ignore_ascii_case("PATH")
                && env_name_ok(name)
                && !value.contains('\0')
                && value.len() <= MAX_ENV_VALUE
        });
        if env.len() > MAX_ENV {
            return Err("This agent's environment cannot be shown in a terminal.".into());
        }
        Ok(TerminalSignIn {
            title: format!("Sign in to {}", definition.name),
            program,
            args,
            env,
        })
    }

    pub async fn logout(self: &Arc<Self>, id: &str) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "Wait for this turn to finish before signing out.")?;
        let record = self.copy_record(&session)?;
        if !record.capabilities.logout {
            return Err("This agent signs out from its own CLI.".into());
        }
        session
            .client
            .logout()
            .await
            .map_err(|error| session.redactor.text(&error.to_string()))?;
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.status = SessionStatus::AuthRequired;
            state.record.error = Some("Signed out. Sign in to continue.".into());
            self.emit_locked(
                &session,
                &mut state,
                "status",
                json!({"status": "auth_required"}),
            )?;
        }
        self.snapshot(id).await
    }

    /// `elicitation/create`: a form or a link for the user. Task sessions
    /// decline (nobody watches them); at most four wait at once; unanswered
    /// ones are cancelled after 10 minutes.
    pub(super) fn elicitation_requested(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        incoming: IncomingRequest,
    ) -> Result<(), String> {
        let decline = |incoming: IncomingRequest| {
            incoming
                .respond(elicitation::decline())
                .map_err(|e| e.to_string())
        };
        if session.task_temp.is_some() {
            return decline(incoming);
        }
        let mut view = match elicitation::parse_create(incoming.params(), now_ms()) {
            Ok(view) => view,
            Err(_) => return decline(incoming),
        };
        let record = self.copy_record(session)?;
        let scoped = match &view.session_id {
            Some(native) => record.native_session_id.as_deref() == Some(native.as_str()),
            None => view.request_scoped && session.authenticating.load(Ordering::Acquire),
        };
        if !scoped {
            return decline(incoming);
        }
        redact_view(&mut view, &session.redactor);
        let question_id = view.id.clone();
        let cancelled = incoming.cancelled();
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            if state.elicitations.len() >= MAX_PENDING_QUESTIONS {
                drop(state);
                return decline(incoming);
            }
            self.emit_locked(
                session,
                &mut state,
                "elicitation",
                serde_json::to_value(&view).map_err(|e| e.to_string())?,
            )?;
            state.elicitations.insert(
                question_id.clone(),
                PendingElicitation {
                    view,
                    responder: incoming,
                },
            );
            self.update_hold(session, &state);
        }
        if session.authenticating.load(Ordering::Acquire) {
            session.auth_asked.send_replace(true);
        }
        let runtime = Arc::downgrade(self);
        let weak = Arc::downgrade(session);
        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_millis(ELICITATION_TTL_MS)) => {}
                _ = cancelled => {}
            }
            if let (Some(runtime), Some(session)) = (runtime.upgrade(), weak.upgrade()) {
                let _ = runtime.finish_elicitation(
                    &session,
                    &question_id,
                    "cancel",
                    elicitation::cancel(),
                );
            }
        });
        Ok(())
    }

    /// Answers a question: `accept` (with the form content), `decline` or
    /// `cancel`. The answer itself is never stored.
    pub async fn respond_elicitation(
        &self,
        id: &str,
        elicitation_id: &str,
        action: &str,
        content: Option<Map<String, Value>>,
    ) -> Result<(), String> {
        let session = self.get_live(id).await?;
        let answer = {
            let state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let pending = state
                .elicitations
                .get(elicitation_id)
                .ok_or("This question has expired.")?;
            match action {
                "accept" => elicitation::accept(&pending.view, &content.unwrap_or_default())?,
                "decline" => elicitation::decline(),
                "cancel" => elicitation::cancel(),
                _ => return Err("Choose accept, decline or cancel.".into()),
            }
        };
        self.finish_elicitation(&session, elicitation_id, action, answer)
    }

    /// `elicitation/complete`: the link the agent asked the user to open
    /// finished; its card closes.
    pub(super) fn elicitation_completed(&self, session: &LiveSession, params: &Value) {
        let Some(agent_id) = params["elicitationId"].as_str() else {
            return;
        };
        let found = session.state.lock().ok().and_then(|state| {
            state
                .elicitations
                .iter()
                .find(|(_, pending)| pending.view.elicitation_id.as_deref() == Some(agent_id))
                .map(|(id, _)| id.clone())
        });
        if let Some(id) = found {
            let _ = self.finish_elicitation(session, &id, "completed", json!({"action": "accept"}));
        }
    }

    fn finish_elicitation(
        &self,
        session: &LiveSession,
        elicitation_id: &str,
        action: &str,
        answer: Value,
    ) -> Result<(), String> {
        let pending = {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            let Some(pending) = state.elicitations.remove(elicitation_id) else {
                return Ok(());
            };
            self.update_hold(session, &state);
            let _ = self.emit_locked(
                session,
                &mut state,
                "elicitation_resolved",
                json!({"id": elicitation_id, "action": action}),
            );
            pending
        };
        pending
            .responder
            .respond(answer)
            .map_err(|error| error.to_string())
    }

    /// Cancels every open question (the agent disconnected).
    pub(super) fn expire_elicitations_now(&self, session: &LiveSession) {
        let ids: Vec<String> = session
            .state
            .lock()
            .map(|state| state.elicitations.keys().cloned().collect())
            .unwrap_or_default();
        for id in ids {
            let _ = self.finish_elicitation(session, &id, "cancel", elicitation::cancel());
        }
    }

    /// `_auth/status_update`: how the agent is signed in, for the usage view.
    pub(super) fn auth_status_update(&self, session: &LiveSession, params: &Value) {
        let Ok(mut state) = session.state.lock() else {
            return;
        };
        let counters = {
            let usage = state
                .record
                .usage
                .get_or_insert_with(super::types::SessionUsage::default);
            usage.apply_auth_status(params, now_ms());
            usage.redact(&session.redactor);
            super::types::UsageCounters {
                context_used: usage.context_used,
                context_size: usage.context_size,
                session: Some(usage.clone()),
                source: "acp_auth".into(),
                ..Default::default()
            }
        };
        if let Ok(data) = serde_json::to_value(counters) {
            let _ = self.emit_locked(session, &mut state, "usage", data);
        }
    }
}

fn redact_view(view: &mut ElicitationView, redactor: &oleafly_acp::redact::Redactor) {
    view.message = redactor.text(&view.message);
    for field in &mut view.fields {
        field.title = field.title.as_deref().map(|text| redactor.text(text));
        field.description = field.description.as_deref().map(|text| redactor.text(text));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn environment_names_follow_the_terminal_rules() {
        assert!(env_name_ok("CLAUDE_CODE_ENTRYPOINT"));
        assert!(!env_name_ok("1BAD"));
        assert!(!env_name_ok("A-B"));
        assert!(!env_name_ok(&"A".repeat(129)));
    }
}
