//! Changing an agent's options (mode, model, effort, fast and the rest)
//! and remembering effort and mode for the agent's next sessions.
use oleafly_acp::controls::{ConfigKind, ConfigValue};
use serde_json::json;
use std::sync::Arc;

use super::preferences::RememberedChoice;
use super::runtime::{AcpRuntime, LiveSession};
use super::types::{SessionControls, SessionSnapshot, SessionStatus};

const BUSY: &str = "Wait for this turn to finish before changing the agent's options.";

/// What happened to a task's requested model.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModelChoice {
    /// No model was asked for, or it is already the agent's model.
    Kept,
    Selected,
    /// The agent does not offer it; it keeps its own model.
    NotOffered,
}

impl AcpRuntime {
    /// Sends one option change and records the agent's confirmation.
    async fn send_config_option(
        &self,
        session: &Arc<LiveSession>,
        config_id: &str,
        value: &ConfigValue,
    ) -> Result<(), String> {
        let record = self.copy_record(session)?;
        record.controls.allows(config_id, value)?;
        let native = record
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
            // The agent confirmed without returning its options.
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

    /// Remembers an effort or mode choice for the agent's next sessions.
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
        self.snapshot(id).await
    }

    /// Legacy mode switch for agents that only report `modes`.
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
        self.change_model(&session, model_id).await?;
        self.snapshot(id).await
    }

    async fn change_model(&self, session: &Arc<LiveSession>, model_id: &str) -> Result<(), String> {
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
        if let Some(config_id) = record.controls.model_config_id.clone() {
            self.send_config_option(session, &config_id, &ConfigValue::Id(model_id.into()))
                .await?;
            let confirmed = self
                .copy_record(session)?
                .controls
                .model_id
                .is_some_and(|current| current == model_id);
            if !confirmed {
                return Err("The agent did not confirm that model. Reconnect to refresh its available models.".into());
            }
            return Ok(());
        }
        let native = record
            .native_session_id
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
        let mut state = session
            .state
            .lock()
            .map_err(|_| "The ACP session is unavailable.")?;
        state.record.controls.model_id = Some(model_id.into());
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

    /// A task's model: kept when none is asked for or it is already
    /// current, selected when offered, otherwise reported as not offered.
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

    /// A new session starts with the agent's remembered effort and (for
    /// interactive sessions) mode, when offered, allowed and different. A
    /// failure is noted and never fails the start.
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
        let interactive = session.task_temp.is_none();
        let wanted = [
            ("effort", "thought_level", prefs.effort.clone()),
            ("mode", "mode", prefs.mode.clone().filter(|_| interactive)),
        ];
        for (slot, category, choice) in wanted {
            let Some(choice) = choice else {
                continue;
            };
            let controls = match self.copy_record(session) {
                Ok(record) => record.controls,
                Err(_) => return,
            };
            let result = if let Some(option) = controls.by_category(category) {
                let ConfigKind::Select {
                    current_value,
                    options,
                } = &option.kind
                else {
                    continue;
                };
                let offered = options
                    .iter()
                    .any(|entry| entry.value == choice.value && !entry.blocked);
                if !offered || current_value.as_deref() == Some(choice.value.as_str()) {
                    continue;
                }
                let config_id = option.id.clone();
                self.send_config_option(session, &config_id, &ConfigValue::Id(choice.value.clone()))
                    .await
            } else if slot == "mode" && controls.allows_mode(&choice.value).is_ok() {
                if controls.mode_id.as_deref() == Some(choice.value.as_str()) {
                    continue;
                }
                self.send_legacy_mode(session, &choice.value).await
            } else {
                continue;
            };
            if let Err(error) = result {
                if let Ok(mut state) = session.state.lock() {
                    let _ = self.emit_locked(
                        session,
                        &mut state,
                        "diagnostics",
                        json!({"preference": slot, "error": session.redactor.text(&error)}),
                    );
                }
            }
        }
    }
}
