use oleafly_acp::controls::{ConfigKind, ConfigOptionView, ConfigValue};
use serde_json::json;
use std::path::Path;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use super::preferences::RememberedChoice;
use super::runtime::{AcpRuntime, LiveSession};
use super::types::{SessionControls, SessionRecord, SessionSnapshot, SessionStatus};

const BUSY: &str = "Wait for this turn to finish before changing the agent's options.";
const MAX_MODE_SWITCHES: u32 = 3;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelChoice {
    Kept,
    Selected,
    NotOffered,
}

impl AcpRuntime {
    async fn send_config_option(
        &self,
        session: &Arc<LiveSession>,
        config_id: &str,
        value: &ConfigValue,
    ) -> Result<(), String> {
        self.copy_record(session)?
            .controls
            .allows(config_id, value)?;
        self.send_config_option_unchecked(session, config_id, value)
            .await
    }

    /// [`Self::send_config_option`] for an option the record does not list:
    /// a session restored from the store knows its models but not the
    /// options they came from. The agent's answer carries every option, so
    /// the record is whole again afterwards.
    pub(super) async fn send_config_option_unchecked(
        &self,
        session: &Arc<LiveSession>,
        config_id: &str,
        value: &ConfigValue,
    ) -> Result<(), String> {
        let native = self
            .copy_record(session)?
            .native_session_id
            .ok_or("The ACP session is not ready.")?;
        let result = session
            .client
            .set_config_option(&native, config_id, value)
            .await
            .map_err(|error| session.redactor.text(&error.to_string()))?;
        if let Err(error) = session.redactor.validate_metadata_ids(&result) {
            let _ = self.fail(session, &error);
            session.client.shutdown().await;
            self.release_live(session).await;
            return Err(error);
        }
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        let answer = session.redactor.value(&result);
        if answer["configOptions"].is_array() {
            state.record.controls.merge(&answer);
        } else if let Some(option) = state
            .record
            .controls
            .options
            .iter_mut()
            .find(|option| option.id == config_id)
        {
            match (&mut option.kind, value) {
                (ConfigKind::Select { current_value, .. }, ConfigValue::Id(id)) => {
                    *current_value = Some(id.clone());
                }
                (ConfigKind::Boolean { current_value }, ConfigValue::Boolean { value, .. }) => {
                    *current_value = *value;
                }
                _ => {}
            }
            if state.record.controls.model_config_id.as_deref() == Some(config_id) {
                if let ConfigValue::Id(id) = value {
                    state.record.controls.model_id = Some(id.clone());
                }
            }
        }
        let controls = serde_json::to_value(&state.record.controls).map_err(|e| e.to_string())?;
        self.emit_locked(
            session,
            &mut state,
            "controls",
            json!({"controls": controls}),
        )
    }

    fn remember_choice(
        &self,
        session: &LiveSession,
        controls: &SessionControls,
        config_id: &str,
        value: &ConfigValue,
    ) {
        let ConfigValue::Id(id) = value else {
            return;
        };
        let Some(option) = controls.by_id(config_id) else {
            return;
        };
        let slot = match option.category.as_deref() {
            Some("thought_level") => "effort",
            Some("mode") => "mode",
            Some("model") => "model",
            _ => return,
        };
        let ConfigKind::Select { options, .. } = &option.kind else {
            return;
        };
        let name = options
            .iter()
            .find(|choice| &choice.value == id)
            .map_or(id.as_str(), |choice| choice.name.as_str());
        self.remember(session, slot, id, name);
    }

    fn remember(&self, session: &LiveSession, slot: &str, value: &str, name: &str) {
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        let Ok(mut prefs) = self.store.agent_preferences(&record.agent_id) else {
            return;
        };
        let choice = Some(RememberedChoice::new(value, name, &session.redactor));
        match slot {
            "effort" => prefs.effort = choice,
            "model" => prefs.model = choice,
            _ => prefs.mode = choice,
        }
        let _ = self
            .store
            .set_agent_preferences(&record.agent_id, &prefs.normalized());
    }

    pub async fn set_config_option(
        self: &Arc<Self>,
        id: &str,
        config_id: &str,
        value: ConfigValue,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session.operation.try_lock().map_err(|_| BUSY)?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::Ready {
            return Err(BUSY.into());
        }
        record.controls.allows(config_id, &value)?;
        self.send_config_option(&session, config_id, &value).await?;
        self.remember_choice(&session, &record.controls, config_id, &value);
        let model = record
            .controls
            .by_id(config_id)
            .is_some_and(|option| option.category.as_deref() == Some("model"));
        if model {
            self.reapply_effort(&session).await;
        }
        self.snapshot(id).await
    }

    pub async fn set_mode(
        self: &Arc<Self>,
        id: &str,
        mode_id: &str,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session.operation.try_lock().map_err(|_| BUSY)?;
        let record = self.copy_record(&session)?;
        if record.status != SessionStatus::Ready {
            return Err(BUSY.into());
        }
        if let Some(option) = record.controls.by_category("mode") {
            let value = ConfigValue::Id(mode_id.to_owned());
            record.controls.allows(&option.id, &value)?;
            let config_id = option.id.clone();
            self.send_config_option(&session, &config_id, &value)
                .await?;
            self.remember_choice(&session, &record.controls, &config_id, &value);
            return self.snapshot(id).await;
        }
        self.send_legacy_mode(&session, mode_id).await?;
        let name = record
            .controls
            .modes
            .iter()
            .find(|mode| mode.id == mode_id)
            .map_or(mode_id.to_owned(), |mode| mode.name.clone());
        self.remember(&session, "mode", mode_id, &name);
        self.snapshot(id).await
    }

    async fn send_legacy_mode(
        &self,
        session: &Arc<LiveSession>,
        mode_id: &str,
    ) -> Result<(), String> {
        let record = self.copy_record(session)?;
        record.controls.allows_mode(mode_id)?;
        let native = record
            .native_session_id
            .ok_or("The ACP session is not ready.")?;
        let result = session
            .client
            .set_mode(&native, mode_id)
            .await
            .map_err(|error| session.redactor.text(&error.to_string()))?;
        session.redactor.validate_metadata_ids(&result)?;
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        state.record.controls.mode_id = Some(mode_id.to_owned());
        state
            .record
            .controls
            .merge(&session.redactor.value(&result));
        let controls = serde_json::to_value(&state.record.controls).map_err(|e| e.to_string())?;
        self.emit_locked(
            session,
            &mut state,
            "controls",
            json!({"controls": controls}),
        )
    }

    pub async fn set_model(
        self: &Arc<Self>,
        id: &str,
        model_id: &str,
    ) -> Result<SessionSnapshot, String> {
        let session = self.get_live(id).await?;
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "Wait for this turn to finish before changing the model.")?;
        let record = self.copy_record(&session)?;
        self.change_model(&session, model_id).await?;
        let name = record
            .controls
            .models
            .iter()
            .find(|model| model.model_id == model_id)
            .map_or(model_id, |model| model.name.as_str());
        self.remember(&session, "model", model_id, name);
        self.snapshot(id).await
    }

    fn confirm_model(&self, session: &Arc<LiveSession>, model_id: &str) -> Result<(), String> {
        let confirmed = self
            .copy_record(session)?
            .controls
            .model_id
            .is_some_and(|current| current == model_id);
        if confirmed {
            Ok(())
        } else {
            Err(
                "The agent did not confirm that model. Reconnect to refresh its available models."
                    .into(),
            )
        }
    }

    async fn change_model(&self, session: &Arc<LiveSession>, model_id: &str) -> Result<(), String> {
        self.switch_model(session, model_id).await?;
        self.reapply_effort(session).await;
        Ok(())
    }

    async fn switch_model(&self, session: &Arc<LiveSession>, model_id: &str) -> Result<(), String> {
        let record = self.copy_record(session)?;
        if record.status != SessionStatus::Ready
            || !record
                .controls
                .models
                .iter()
                .any(|model| model.model_id == model_id)
        {
            return Err("This model is not available in the current ACP session.".into());
        }
        let config_id = record.controls.model_config_id.clone().or_else(|| {
            record
                .controls
                .by_category("model")
                .map(|option| option.id.clone())
        });
        if let Some(config_id) = config_id {
            self.send_config_option(session, &config_id, &ConfigValue::Id(model_id.into()))
                .await?;
            return self.confirm_model(session, model_id);
        }
        if !record.controls.legacy_models {
            // The models came from a config option, but a session restored
            // from the store has the list without the option. Agents built
            // on the ACP SDK (Claude Code, Codex) call it `model`, and their
            // answer carries every option, so the record is whole again; one
            // that names it differently says so, and the v1 request is next.
            match self
                .send_config_option_unchecked(session, "model", &ConfigValue::Id(model_id.into()))
                .await
            {
                Ok(()) => return self.confirm_model(session, model_id),
                Err(error) if error.contains("Unknown config option") => {}
                Err(error) => return Err(error),
            }
        }
        let native = record
            .native_session_id
            .clone()
            .ok_or("The ACP session is not ready.")?;
        let result = session
            .client
            .set_model(&native, model_id)
            .await
            .map_err(|error| session.redactor.text(&error.to_string()))?;
        if let Err(error) = session.redactor.validate_metadata_ids(&result) {
            let _ = self.fail(session, &error);
            session.client.shutdown().await;
            self.release_live(session).await;
            return Err(error);
        }
        {
            let mut state = session
                .state
                .lock()
                .map_err(|_| "The ACP session is unavailable.")?;
            state.record.controls.model_id = Some(model_id.into());
            state
                .record
                .controls
                .merge(&session.redactor.value(&result));
            let controls =
                serde_json::to_value(&state.record.controls).map_err(|e| e.to_string())?;
            self.emit_locked(
                session,
                &mut state,
                "controls",
                json!({"controls": controls}),
            )?;
        }
        self.reattach_tools(session, &record).await;
        Ok(())
    }

    async fn reattach_tools(&self, session: &Arc<LiveSession>, record: &SessionRecord) {
        if record.agent_id != super::hermes::HERMES_ID
            || record.remote.is_some()
            || !record.capabilities.resume
        {
            return;
        }
        let Some(native) = record.native_session_id.as_deref() else {
            return;
        };
        let servers = session
            .mcp_servers
            .lock()
            .map(|servers| servers.clone())
            .unwrap_or_default();
        if servers.is_empty() {
            return;
        }
        let cwd = super::runtime::launch_root_for(Path::new(&record.project_path))
            .to_string_lossy()
            .into_owned();
        if session
            .client
            .resume_session(native, &cwd, &servers)
            .await
            .is_err()
        {
            if let Ok(mut state) = session.state.lock() {
                let _ = self.emit_locked(
                    session,
                    &mut state,
                    "notice",
                    json!({"severity": "warning",
                        "title": super::failures::coded(super::failures::HERMES_TOOLS_LOST),
                        "description": super::failures::coded(super::failures::HERMES_TOOLS_ADVICE)}),
                );
            }
        }
    }

    pub async fn select_model_if_offered(
        self: &Arc<Self>,
        id: &str,
        model_id: &str,
    ) -> Result<ModelChoice, String> {
        let model_id = model_id.trim();
        let session = self.get_live(id).await?;
        let record = self.copy_record(&session)?;
        if model_id.is_empty() || record.controls.model_id.as_deref() == Some(model_id) {
            return Ok(ModelChoice::Kept);
        }
        if !record
            .controls
            .models
            .iter()
            .any(|model| model.model_id == model_id)
        {
            return Ok(ModelChoice::NotOffered);
        }
        let _operation = session
            .operation
            .try_lock()
            .map_err(|_| "Wait for this turn to finish before changing the model.")?;
        self.change_model(&session, model_id).await?;
        Ok(ModelChoice::Selected)
    }

    pub(super) async fn leave_blocked_mode(self: &Arc<Self>, session: &Arc<LiveSession>) {
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        let remembered = self
            .store
            .agent_preferences(&record.agent_id)
            .ok()
            .and_then(|prefs| prefs.mode)
            .map(|choice| choice.value);
        let Some(blocked) = record.controls.blocked_mode(remembered.as_deref()) else {
            return;
        };
        let attempts = session.mode_switches.fetch_add(1, Ordering::AcqRel);
        if attempts > MAX_MODE_SWITCHES {
            return;
        }
        let switched = match blocked.switch.filter(|_| attempts < MAX_MODE_SWITCHES) {
            Some(switch) => {
                let result = match switch.config_id {
                    Some(config_id) => {
                        self.send_config_option(session, &config_id, &ConfigValue::Id(switch.to))
                            .await
                    }
                    None => self.send_legacy_mode(session, &switch.to).await,
                };
                result.is_ok()
            }
            None => false,
        };
        let still_blocked = self
            .copy_record(session)
            .ok()
            .is_some_and(|record| record.controls.blocked_mode(None).is_some());
        if switched && !still_blocked {
            return;
        }
        if let Ok(mut state) = session.state.lock() {
            let _ = self.emit_locked(
                session,
                &mut state,
                "notice",
                json!({"severity": "warning",
                    "title": crate::i18n::t_with(
                        "acp.blockedMode.title",
                        &[("mode", &session.redactor.text(&blocked.name))],
                    ),
                    "description": crate::i18n::t("acp.blockedMode.description")}),
            );
        }
    }

    fn note_preference(&self, session: &LiveSession, preference: &str, error: &str) {
        if let Ok(mut state) = session.state.lock() {
            let _ = self.emit_locked(
                session,
                &mut state,
                "diagnostics",
                json!({"preference": preference, "error": session.redactor.text(error)}),
            );
        }
    }

    async fn select_choice(
        &self,
        session: &Arc<LiveSession>,
        category: &str,
        value: &str,
    ) -> Option<Result<(), String>> {
        let controls = self.copy_record(session).ok()?.controls;
        if let Some(option) = controls.by_category(category) {
            let ConfigKind::Select {
                current_value,
                options,
            } = &option.kind
            else {
                return None;
            };
            let offered = options
                .iter()
                .any(|choice| choice.value == value && !choice.blocked);
            if !offered || current_value.as_deref() == Some(value) {
                return None;
            }
            let config_id = option.id.clone();
            return Some(
                self.send_config_option(session, &config_id, &ConfigValue::Id(value.to_owned()))
                    .await,
            );
        }
        if category != "mode"
            || controls.mode_id.as_deref() == Some(value)
            || controls.allows_mode(value).is_err()
        {
            return None;
        }
        Some(self.send_legacy_mode(session, value).await)
    }

    async fn select_model(&self, session: &Arc<LiveSession>, model_id: &str) {
        let wanted = self.copy_record(session).is_ok_and(|record| {
            record.controls.model_id.as_deref() != Some(model_id)
                && record
                    .controls
                    .models
                    .iter()
                    .any(|model| model.model_id == model_id)
        });
        if !wanted {
            return;
        }
        if let Err(error) = self.switch_model(session, model_id).await {
            self.note_preference(session, "model", &error);
        }
    }

    async fn reapply_effort(&self, session: &Arc<LiveSession>) {
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        let Some(effort) = self
            .store
            .agent_preferences(&record.agent_id)
            .ok()
            .and_then(|prefs| prefs.effort)
        else {
            return;
        };
        if let Some(Err(error)) = self
            .select_choice(session, "thought_level", &effort.value)
            .await
        {
            self.note_preference(session, "effort", &error);
        }
    }

    pub(super) async fn restore_controls(
        self: &Arc<Self>,
        session: &Arc<LiveSession>,
        before: &Restore,
    ) {
        if let Some(model) = &before.model {
            self.select_model(session, model).await;
        }
        if let Some(mode) = &before.mode {
            if let Some(Err(error)) = self.select_choice(session, "mode", mode).await {
                self.note_preference(session, "mode", &error);
            }
        }
        for (config_id, value) in &before.effort {
            let Ok(record) = self.copy_record(session) else {
                return;
            };
            let Some(ConfigKind::Select {
                current_value,
                options,
            }) = record.controls.by_id(config_id).map(|option| &option.kind)
            else {
                continue;
            };
            let offered = options
                .iter()
                .any(|choice| &choice.value == value && !choice.blocked);
            if !offered || current_value.as_ref() == Some(value) {
                continue;
            }
            let restored = self
                .send_config_option(session, config_id, &ConfigValue::Id(value.clone()))
                .await;
            if let Err(error) = restored {
                self.note_preference(session, "effort", &error);
            }
        }
    }

    pub(super) async fn apply_remembered(self: &Arc<Self>, session: &Arc<LiveSession>) {
        let Ok(record) = self.copy_record(session) else {
            return;
        };
        if record.status != SessionStatus::Ready {
            return;
        }
        let Ok(prefs) = self.store.agent_preferences(&record.agent_id) else {
            return;
        };
        if let Some(model) = &prefs.model {
            self.select_model(session, &model.value).await;
        }
        let interactive = session.task_temp.is_none();
        let wanted = [
            ("effort", "thought_level", prefs.effort.clone()),
            ("mode", "mode", prefs.mode.clone().filter(|_| interactive)),
        ];
        for (slot, category, choice) in wanted {
            let Some(choice) = choice else {
                continue;
            };
            if let Some(Err(error)) = self.select_choice(session, category, &choice.value).await {
                self.note_preference(session, slot, &error);
            }
        }
    }
}

#[derive(Debug, Default)]
pub(super) struct Restore {
    model: Option<String>,
    mode: Option<String>,
    effort: Vec<(String, String)>,
}

pub(super) fn restore_values(controls: &SessionControls) -> Restore {
    let mode = match controls.by_category("mode").map(|option| &option.kind) {
        Some(ConfigKind::Select { current_value, .. }) => current_value.clone(),
        _ => controls.mode_id.clone(),
    };
    Restore {
        model: controls.model_id.clone(),
        mode,
        effort: effort_values(controls),
    }
}

fn is_effort(option: &ConfigOptionView) -> bool {
    option.category.as_deref() == Some("thought_level")
        || matches!(option.id.as_str(), "effort" | "reasoning_effort")
}

fn effort_values(controls: &SessionControls) -> Vec<(String, String)> {
    controls
        .options
        .iter()
        .filter(|option| is_effort(option))
        .filter_map(|option| match &option.kind {
            ConfigKind::Select {
                current_value: Some(value),
                ..
            } => Some((option.id.clone(), value.clone())),
            _ => None,
        })
        .collect()
}
