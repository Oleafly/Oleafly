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

fn env_name_blocked(name: &str) -> bool {
    let upper = name.to_ascii_uppercase();
    upper.starts_with("LD_")
        || upper.starts_with("DYLD_")
        || upper.starts_with("GIT_")
        || matches!(
            upper.as_str(),
            "PATH"
                | "PATHEXT"
                | "COMSPEC"
                | "PSMODULEPATH"
                | "NODE_OPTIONS"
                | "NODE_PATH"
                | "PROMPT_COMMAND"
                | "PS1"
                | "PS2"
                | "PS4"
                | "BASH_ENV"
                | "ENV"
                | "SHELLOPTS"
                | "BASHOPTS"
                | "IFS"
                | "ZDOTDIR"
                | "PYTHONSTARTUP"
                | "PYTHONPATH"
                | "PYTHONHOME"
                | "PERL5OPT"
                | "PERL5LIB"
                | "RUBYOPT"
                | "RUBYLIB"
                | "JAVA_TOOL_OPTIONS"
                | "_JAVA_OPTIONS"
        )
}

impl AcpRuntime {
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

    pub async fn sign_in_command(
        &self,
        agent_id: &str,
        session_id: Option<&str>,
        method_id: &str,
    ) -> Result<TerminalSignIn, String> {
        let definition = self.definition(agent_id)?;
        let mut project_id = None;
        let methods = match session_id {
            Some(id) => {
                let record = match self.get_live(id).await {
                    Ok(session) => self.copy_record(&session)?,
                    Err(_) => self.store.get(id)?,
                };
                if record.remote.is_some() {
                    return Err(
                        "This conversation runs on another machine. Sign in to the agent there."
                            .into(),
                    );
                }
                project_id = Some(record.project_id);
                record.auth_methods
            }
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
        let mut launch = {
            let root = self.root.clone();
            let definition = definition.clone();
            catalog::blocking(move || {
                catalog::plan(&root, &definition, program.as_deref().map(Path::new)).launch
            })
            .await??
        };
        if let Some(project_id) = &project_id {
            let settings = self.hermes_settings(&definition, project_id);
            sign_in_profile(&mut launch, &definition, project_id, &settings)?;
        }
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
        let handoff = catalog::vendor_cli(&definition).and_then(|vendor| vendor.cli_env);
        let env = terminal_env(&launch.env, handoff, &method.env)?;
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
                "accept" => {
                    let content = content.unwrap_or_default();
                    let answer = elicitation::accept(&pending.view, &content)?;
                    for field in pending.view.fields.iter().filter(|field| field.secret) {
                        if let Some(value) = content.get(&field.name).and_then(Value::as_str) {
                            session.redactor.add_secret(value);
                        }
                    }
                    answer
                }
                "decline" => elicitation::decline(),
                "cancel" => elicitation::cancel(),
                _ => return Err("Choose accept, decline or cancel.".into()),
            }
        };
        self.finish_elicitation(&session, elicitation_id, action, answer)
    }

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
                session: Some(usage.without_plan()),
                source: "acp_auth".into(),
                ..Default::default()
            }
        };
        if let Ok(data) = serde_json::to_value(counters) {
            let _ = self.emit_locked(session, &mut state, "usage", data);
        }
    }
}

fn terminal_env(
    launch_env: &[(String, std::ffi::OsString)],
    handoff: Option<&str>,
    method_env: &BTreeMap<String, String>,
) -> Result<BTreeMap<String, String>, String> {
    let mut env = BTreeMap::new();
    for (name, value) in launch_env {
        if name.eq_ignore_ascii_case("PATH")
            || (crate::program_locator::shell_supplied_env_name(name)
                && handoff.is_none_or(|handoff| !name.eq_ignore_ascii_case(handoff)))
        {
            continue;
        }
        let value = value
            .clone()
            .into_string()
            .map_err(|_| "This agent's environment cannot be shown in a terminal.")?;
        env.insert(name.clone(), value);
    }
    for (name, value) in method_env {
        if name.eq_ignore_ascii_case("PATH") {
            continue;
        }
        if env_name_blocked(name) {
            return Err(if env_name_ok(name) {
                format!("This agent's sign-in sets {name}, which Oleafly does not allow.")
            } else {
                "This agent's sign-in sets a variable that Oleafly does not allow.".into()
            });
        }
        env.insert(name.clone(), value.clone());
    }
    env.retain(|name, value| {
        env_name_ok(name) && !value.contains('\0') && value.len() <= MAX_ENV_VALUE
    });
    if env.len() > MAX_ENV {
        return Err("This agent's environment cannot be shown in a terminal.".into());
    }
    Ok(env)
}

fn sign_in_profile(
    launch: &mut catalog::Launch,
    definition: &super::types::AgentDefinition,
    project_id: &str,
    settings: &super::hermes::HermesSettings,
) -> Result<(), String> {
    if settings.mode != super::hermes::HermesMode::Project {
        return Ok(());
    }
    let definition_args = definition
        .distribution
        .command
        .as_ref()
        .map(|command| command.args.clone())
        .unwrap_or_default();
    super::hermes::apply_profile(launch, &definition_args, project_id, settings)
}

fn redact_view(view: &mut ElicitationView, redactor: &oleafly_acp::redact::Redactor) {
    view.message = redactor.text(&view.message);
    for field in &mut view.fields {
        field.title = field.title.as_deref().map(|text| redactor.text(text));
        field.description = field.description.as_deref().map(|text| redactor.text(text));
        if let Some(Value::String(default)) = &mut field.default {
            *default = redactor.text(default);
        }
        if let oleafly_acp::elicitation::FieldKind::Choice { options, .. } = &mut field.kind {
            for (_, title) in options.iter_mut() {
                *title = redactor.text(title);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::acp::types::{AuthMethod, RemoteTarget, SessionRecord};
    use oleafly_acp::capabilities::TerminalAuthCommand;

    #[test]
    fn environment_names_follow_the_terminal_rules() {
        assert!(env_name_ok("CLAUDE_CODE_ENTRYPOINT"));
        assert!(!env_name_ok("1BAD"));
        assert!(!env_name_ok("A-B"));
        assert!(!env_name_ok(&"A".repeat(129)));
    }

    #[test]
    fn names_that_change_how_programs_start_are_blocked() {
        for name in [
            "LD_PRELOAD",
            "ld_library_path",
            "DYLD_INSERT_LIBRARIES",
            "NODE_OPTIONS",
            "PROMPT_COMMAND",
            "PS1",
            "PS2",
            "PS4",
            "BASH_ENV",
            "ENV",
            "ZDOTDIR",
            "PYTHONSTARTUP",
            "PYTHONPATH",
            "PERL5OPT",
            "RUBYOPT",
            "GIT_SSH_COMMAND",
            "git_config_count",
            "PATH",
            "Path",
        ] {
            assert!(env_name_blocked(name), "{name}");
        }
        for name in [
            "CLAUDE_CODE_ENTRYPOINT",
            "CODEX_HOME",
            "ANTHROPIC_BASE_URL",
            "PSEUDO",
            "LDAP_URI",
            "ENVIRONMENT",
        ] {
            assert!(!env_name_blocked(name), "{name}");
        }
    }

    fn runtime_with_method(
        method: AuthMethod,
        remote: Option<RemoteTarget>,
    ) -> (tempfile::TempDir, Arc<AcpRuntime>) {
        let temp = crate::acp::tests::fixture_temp();
        let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
        let definition = crate::acp::tests::fixture_definition(Vec::new(), temp.path());
        runtime
            .register(&serde_json::to_string(&definition).unwrap())
            .unwrap();
        runtime
            .store
            .save(&SessionRecord {
                id: "saved".into(),
                project_id: "project".into(),
                project_path: temp.path().to_string_lossy().into_owned(),
                agent_id: definition.id,
                status: SessionStatus::AuthRequired,
                auth_methods: vec![method],
                remote,
                ..SessionRecord::default()
            })
            .unwrap();
        (temp, runtime)
    }

    fn agent_method(env: &[(&str, &str)]) -> AuthMethod {
        AuthMethod {
            id: "login".into(),
            name: "Sign in".into(),
            description: None,
            kind: Some("terminal".into()),
            args: vec!["--login".into()],
            env: env
                .iter()
                .map(|(name, value)| (name.to_string(), value.to_string()))
                .collect(),
            api_key_provider: None,
            terminal_command: None,
        }
    }

    #[tokio::test]
    async fn a_local_sign_in_keeps_harmless_environment_and_arguments() {
        let (_temp, runtime) = runtime_with_method(
            agent_method(&[("CLAUDE_CODE_ENTRYPOINT", "cli"), ("PATH", "/evil")]),
            None,
        );
        let sign_in = runtime
            .sign_in_command("fixture-agent", Some("saved"), "login")
            .await
            .unwrap();
        assert_eq!(sign_in.args.last().map(String::as_str), Some("--login"));
        assert_eq!(sign_in.env["CLAUDE_CODE_ENTRYPOINT"], "cli");
        assert!(!sign_in
            .env
            .keys()
            .any(|name| name.eq_ignore_ascii_case("PATH")));
    }

    #[test]
    fn the_terminal_gets_no_variables_its_own_login_shell_already_sets() {
        let launch: Vec<(String, std::ffi::OsString)> = [
            ("PATH", "/bin"),
            ("HTTPS_PROXY", "http://user:pass@127.0.0.1:7890"),
            ("NO_PROXY", "127.0.0.1,localhost,::1"),
            ("ANTHROPIC_AUTH_TOKEN", "sk-secret-123456789"),
            ("DEEPSEEK_API_KEY", "sk-deepseek-123456789"),
            ("NODE_NO_WARNINGS", "1"),
            ("PYTHONIOENCODING", "utf-8"),
            ("CLAUDE_CODE_EXECUTABLE", "/Users/me/.local/bin/claude"),
            ("OLEAFLY_CLI", "/Applications/Oleafly.app/oleafly"),
        ]
        .iter()
        .map(|(name, value)| (name.to_string(), value.into()))
        .collect();
        let env = terminal_env(
            &launch,
            Some("CLAUDE_CODE_EXECUTABLE"),
            &BTreeMap::from([("CLAUDE_CODE_ENTRYPOINT".into(), "cli".into())]),
        )
        .unwrap();
        assert_eq!(
            env.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "CLAUDE_CODE_ENTRYPOINT",
                "CLAUDE_CODE_EXECUTABLE",
                "OLEAFLY_CLI"
            ]
        );
    }

    #[tokio::test]
    async fn a_sign_in_that_sets_startup_variables_is_refused() {
        for name in [
            "LD_PRELOAD",
            "NODE_OPTIONS",
            "PROMPT_COMMAND",
            "GIT_SSH_COMMAND",
        ] {
            let (_temp, runtime) = runtime_with_method(agent_method(&[(name, "x")]), None);
            let error = runtime
                .sign_in_command("fixture-agent", Some("saved"), "login")
                .await
                .unwrap_err();
            assert!(error.contains(name), "{error}");
        }
    }

    #[tokio::test]
    async fn a_conversation_on_another_machine_gets_no_agent_written_sign_in() {
        let mut method = agent_method(&[("CLAUDE_CODE_ENTRYPOINT", "cli")]);
        method.terminal_command = Some(TerminalAuthCommand {
            command: crate::acp::tests::fixture_python()
                .to_string_lossy()
                .into_owned(),
            args: vec!["-c".into(), "print('signed in')".into()],
            label: Some("Sign in".into()),
        });
        let (_temp, runtime) = runtime_with_method(
            method,
            Some(RemoteTarget {
                host: "lab".into(),
                folder: "/home/me/thesis".into(),
            }),
        );
        let error = runtime
            .sign_in_command("fixture-agent", Some("saved"), "login")
            .await
            .unwrap_err();
        assert!(error.contains("another machine"), "{error}");
    }

    #[test]
    fn a_terminal_sign_in_for_a_hermes_project_profile_signs_in_to_that_profile() {
        let definition = catalog::builtins()
            .into_iter()
            .find(|definition| definition.id == super::super::hermes::HERMES_ID)
            .unwrap();
        let launch = || catalog::Launch {
            executable: std::path::PathBuf::from("/usr/local/bin/hermes"),
            args: definition
                .distribution
                .command
                .as_ref()
                .map(|command| command.args.clone())
                .unwrap_or_default(),
            version: None,
            managed: false,
            batch: false,
            entry: None,
            needs_local_folder: false,
            env: Vec::new(),
        };
        let mut project = launch();
        let settings = super::super::hermes::HermesSettings {
            mode: super::super::hermes::HermesMode::Project,
            ..Default::default()
        };
        sign_in_profile(&mut project, &definition, "thesis", &settings).unwrap();
        assert_eq!(&project.args[..2], ["-p", "oleafly-thesis"]);
        let mut default = launch();
        sign_in_profile(&mut default, &definition, "thesis", &Default::default()).unwrap();
        assert_eq!(default.args, launch().args);
    }
}
