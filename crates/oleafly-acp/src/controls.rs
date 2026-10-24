//! Session controls: the agent's config options (mode, model, effort, fast
//! and the rest), plus the legacy `models`/`modes` objects older agents
//! still send.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MAX_OPTIONS: usize = 32;
const MAX_CHOICES: usize = 256;

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOption {
    pub model_id: String,
    pub name: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionControls {
    pub models: Vec<ModelOption>,
    pub model_id: Option<String>,
    pub model_config_id: Option<String>,
    /// Every config option, in the agent's order (at most 32).
    #[serde(default)]
    pub options: Vec<ConfigOptionView>,
    /// Legacy `SessionModeState` modes.
    #[serde(default)]
    pub modes: Vec<ModeOption>,
    #[serde(default)]
    pub mode_id: Option<String>,
    /// The models came from the legacy `models` object.
    #[serde(default)]
    pub legacy_models: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigOptionView {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub category: Option<String>,
    pub kind: ConfigKind,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum ConfigKind {
    Select {
        current_value: Option<String>,
        options: Vec<SelectChoice>,
    },
    Boolean {
        current_value: bool,
    },
    Unsupported {
        raw_type: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectChoice {
    pub value: String,
    pub name: String,
    pub description: Option<String>,
    pub group: Option<String>,
    /// A permission-bypass choice: listed, never selectable.
    pub blocked: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModeOption {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub blocked: bool,
}

/// The mode an agent is in when Oleafly blocks it, and the way out.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BlockedMode {
    /// The blocked mode's name.
    pub name: String,
    /// Where to switch to; `None` when the agent offers no other mode.
    pub switch: Option<ModeSwitch>,
}

/// A switch to another mode: through the agent's mode option, or (`None`)
/// the legacy `modes` object.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ModeSwitch {
    pub config_id: Option<String>,
    pub to: String,
}

/// A config option value: a choice id, or a typed boolean.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConfigValue {
    Id(String),
    Boolean { r#type: BooleanTag, value: bool },
}

impl ConfigValue {
    pub fn boolean(value: bool) -> Self {
        Self::Boolean {
            r#type: BooleanTag::Boolean,
            value,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BooleanTag {
    Boolean,
}

/// The `session/set_config_option` params for `value`.
pub fn set_config_option_params(session: &str, config_id: &str, value: &ConfigValue) -> Value {
    match value {
        ConfigValue::Id(id) => json!({"sessionId": session, "configId": config_id, "value": id}),
        ConfigValue::Boolean { value, .. } => json!({
            "sessionId": session,
            "configId": config_id,
            "type": "boolean",
            "value": value,
        }),
    }
}

/// Whether a choice turns permission checks off (Claude's
/// `bypassPermissions`, Codex's "Full access", YOLO modes). Oleafly lists
/// them but never selects them.
pub fn is_bypass_choice(value: &str, name: &str) -> bool {
    let value = value.to_ascii_lowercase();
    let name = name.to_ascii_lowercase();
    [
        "bypass",
        "full-access",
        "full_access",
        "full access",
        "yolo",
        "danger",
    ]
    .iter()
    .any(|marker| value.contains(marker) || name.contains(marker))
}

fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|text| !text.is_empty() && text.len() <= 512)
        .map(str::to_owned)
}

fn select_choices(options: &Value) -> Vec<SelectChoice> {
    let mut choices = Vec::new();
    for entry in options.as_array().into_iter().flatten() {
        // A group: {"group"?: id, "name": label, "options": [...]}.
        if let Some(members) = entry["options"].as_array() {
            let group = text(&entry["name"]).or_else(|| text(&entry["group"]));
            for member in members {
                if let Some(choice) = select_choice(member, group.clone()) {
                    choices.push(choice);
                }
            }
        } else if let Some(choice) = select_choice(entry, None) {
            choices.push(choice);
        }
        if choices.len() >= MAX_CHOICES {
            choices.truncate(MAX_CHOICES);
            break;
        }
    }
    choices
}

fn select_choice(value: &Value, group: Option<String>) -> Option<SelectChoice> {
    let id = text(&value["value"])?;
    let name = text(&value["name"]).unwrap_or_else(|| id.clone());
    Some(SelectChoice {
        blocked: is_bypass_choice(&id, &name),
        value: id,
        name,
        description: text(&value["description"]),
        group,
    })
}

fn option_view(value: &Value) -> Option<ConfigOptionView> {
    let id = text(&value["id"])?;
    let kind = match value["type"].as_str() {
        Some("select") => ConfigKind::Select {
            current_value: text(&value["currentValue"]),
            options: select_choices(&value["options"]),
        },
        Some("boolean") => ConfigKind::Boolean {
            current_value: value["currentValue"].as_bool().unwrap_or(false),
        },
        other => ConfigKind::Unsupported {
            raw_type: other.unwrap_or("").chars().take(64).collect(),
        },
    };
    Some(ConfigOptionView {
        name: text(&value["name"]).unwrap_or_else(|| id.clone()),
        id,
        description: text(&value["description"]),
        category: text(&value["category"]),
        kind,
    })
}

impl SessionControls {
    /// Reads config options (and the legacy `models`/`modes` objects) from
    /// a `session/new`, `load`, `resume` or `set_*` answer, or from an
    /// options update.
    pub fn merge(&mut self, value: &Value) {
        let mut has_model_option = false;
        if let Some(options) = value["configOptions"].as_array() {
            self.options = options
                .iter()
                .filter_map(option_view)
                .take(MAX_OPTIONS)
                .collect();
            if let Some(model) = options
                .iter()
                .find(|v| v["category"] == "model" && v["type"] == "select")
            {
                has_model_option = true;
                self.model_config_id = model["id"].as_str().map(str::to_owned);
                self.model_id = model["currentValue"].as_str().map(str::to_owned);
                self.legacy_models = false;
                self.models.clear();
                if let Some(values) = model["options"].as_array() {
                    for option in values {
                        let values = option["options"]
                            .as_array()
                            .map(Vec::as_slice)
                            .unwrap_or_else(|| std::slice::from_ref(option));
                        for value in values {
                            if let (Some(id), Some(name)) =
                                (value["value"].as_str(), value["name"].as_str())
                            {
                                self.models.push(ModelOption {
                                    model_id: id.into(),
                                    name: name.into(),
                                });
                            }
                        }
                    }
                }
            }
        }
        if !has_model_option && value["models"].is_object() {
            self.legacy_models = true;
            self.model_config_id = None;
            self.model_id = value["models"]["currentModelId"]
                .as_str()
                .map(str::to_owned);
            self.models = value["models"]["availableModels"]
                .as_array()
                .map(|v| {
                    v.iter()
                        .filter_map(|v| serde_json::from_value(v.clone()).ok())
                        .collect()
                })
                .unwrap_or_default();
        }
        if value["modes"].is_object() {
            self.mode_id = text(&value["modes"]["currentModeId"]);
            self.modes = value["modes"]["availableModes"]
                .as_array()
                .map(|modes| {
                    modes
                        .iter()
                        .filter_map(|mode| {
                            let id = text(&mode["id"])?;
                            let name = text(&mode["name"]).unwrap_or_else(|| id.clone());
                            Some(ModeOption {
                                blocked: is_bypass_choice(&id, &name),
                                id,
                                name,
                                description: text(&mode["description"]),
                            })
                        })
                        .take(MAX_CHOICES)
                        .collect()
                })
                .unwrap_or_default();
        }
    }

    /// Applies a `session/update` about controls.
    pub fn apply_update(&mut self, update: &Value) {
        match update["sessionUpdate"].as_str() {
            Some("config_option_update" | "config_options_update") => self.merge(update),
            Some("current_model_update") => {
                self.model_id = update["currentModelId"].as_str().map(str::to_owned);
            }
            Some("current_mode_update") => {
                self.mode_id = text(&update["currentModeId"]);
            }
            _ => {}
        }
    }

    /// The mode the agent is in, when it is one Oleafly blocks (permission
    /// checks off). `preferred` is the mode to switch to first, then the
    /// agent's `default` and `auto` modes, then any mode that is not blocked.
    pub fn blocked_mode(&self, preferred: Option<&str>) -> Option<BlockedMode> {
        fn pick<'a>(
            choices: impl Iterator<Item = (&'a str, bool)> + Clone,
            preferred: Option<&str>,
        ) -> Option<&'a str> {
            let allowed = |wanted: &str| {
                choices
                    .clone()
                    .find(|(value, blocked)| !blocked && value.eq_ignore_ascii_case(wanted))
                    .map(|(value, _)| value)
            };
            preferred
                .and_then(allowed)
                .or_else(|| allowed("default"))
                .or_else(|| allowed("auto"))
                .or_else(|| {
                    choices
                        .clone()
                        .find(|(_, blocked)| !blocked)
                        .map(|(v, _)| v)
                })
        }
        if let Some(option) = self.by_category("mode") {
            let ConfigKind::Select {
                current_value: Some(current),
                options,
            } = &option.kind
            else {
                return None;
            };
            let in_use = options.iter().find(|c| &c.value == current && c.blocked)?;
            let to = pick(
                options.iter().map(|c| (c.value.as_str(), c.blocked)),
                preferred,
            );
            return Some(BlockedMode {
                name: in_use.name.clone(),
                switch: to.map(|to| ModeSwitch {
                    config_id: Some(option.id.clone()),
                    to: to.to_owned(),
                }),
            });
        }
        let current = self.mode_id.as_deref()?;
        let in_use = self.modes.iter().find(|m| m.id == current && m.blocked)?;
        let to = pick(
            self.modes.iter().map(|m| (m.id.as_str(), m.blocked)),
            preferred,
        );
        Some(BlockedMode {
            name: in_use.name.clone(),
            switch: to.map(|to| ModeSwitch {
                config_id: None,
                to: to.to_owned(),
            }),
        })
    }

    pub fn by_category(&self, category: &str) -> Option<&ConfigOptionView> {
        self.options
            .iter()
            .find(|option| option.category.as_deref() == Some(category))
    }

    pub fn by_id(&self, config_id: &str) -> Option<&ConfigOptionView> {
        self.options.iter().find(|option| option.id == config_id)
    }

    /// Whether `value` may be set on `config_id`.
    pub fn allows(&self, config_id: &str, value: &ConfigValue) -> Result<(), String> {
        let option = self
            .by_id(config_id)
            .ok_or("This option is not available in the current ACP session.")?;
        match (&option.kind, value) {
            (ConfigKind::Select { options, .. }, ConfigValue::Id(id)) => {
                let choice = options
                    .iter()
                    .find(|choice| &choice.value == id)
                    .ok_or("This choice is not available in the current ACP session.")?;
                if choice.blocked {
                    return Err(
                        "Oleafly keeps permission checks on, so this mode is not available.".into(),
                    );
                }
                Ok(())
            }
            (ConfigKind::Boolean { .. }, ConfigValue::Boolean { .. }) => Ok(()),
            _ => Err("This option does not take that kind of value.".into()),
        }
    }

    /// Whether a legacy mode may be selected.
    pub fn allows_mode(&self, mode_id: &str) -> Result<(), String> {
        let mode = self
            .modes
            .iter()
            .find(|mode| mode.id == mode_id)
            .ok_or("This mode is not available in the current ACP session.")?;
        if mode.blocked {
            return Err(
                "Oleafly keeps permission checks on, so this mode is not available.".into(),
            );
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claude() -> Value {
        json!({"configOptions": [
            {"id": "mode", "name": "Mode", "category": "mode", "type": "select", "currentValue": "default",
             "options": [
                {"value": "default", "name": "Default"},
                {"value": "acceptEdits", "name": "Accept edits"},
                {"value": "plan", "name": "Plan"},
                {"value": "bypassPermissions", "name": "Bypass permissions"}]},
            {"id": "model", "name": "Model", "category": "model", "type": "select", "currentValue": "opus",
             "options": [{"value": "opus", "name": "Opus"}, {"value": "sonnet", "name": "Sonnet"}]},
            {"id": "effort", "name": "Effort", "category": "thought_level", "type": "select", "currentValue": "default",
             "options": [{"value": "default", "name": "Default"}, {"value": "low", "name": "Low"},
                         {"value": "high", "name": "High"}, {"value": "max", "name": "Max"}]},
            {"id": "fast", "name": "Fast mode", "category": "model_config", "type": "boolean", "currentValue": false},
        ]})
    }

    fn ids(controls: &SessionControls) -> Vec<&str> {
        controls
            .options
            .iter()
            .map(|option| option.id.as_str())
            .collect()
    }

    #[test]
    fn claude_options_keep_agent_order_and_categories() {
        let mut controls = SessionControls::default();
        controls.merge(&claude());
        assert_eq!(ids(&controls), ["mode", "model", "effort", "fast"]);
        assert!(matches!(
            controls.by_category("model_config").unwrap().kind,
            ConfigKind::Boolean {
                current_value: false
            }
        ));
        assert_eq!(controls.model_config_id.as_deref(), Some("model"));
        assert_eq!(controls.model_id.as_deref(), Some("opus"));
        assert_eq!(controls.models.len(), 2);
        assert!(!controls.legacy_models);
    }

    #[test]
    fn grouped_select_options_flatten_with_their_group_names() {
        let mut controls = SessionControls::default();
        controls.merge(&json!({"configOptions": [{"id": "model", "name": "Model", "type": "select",
            "options": [{"group": "anthropic", "name": "Anthropic", "options": [{"value": "opus", "name": "Opus"}]},
                        {"value": "local", "name": "Local"}]}]}));
        let ConfigKind::Select { options, .. } = &controls.options[0].kind else {
            panic!("a select option");
        };
        assert_eq!(options[0].group.as_deref(), Some("Anthropic"));
        assert_eq!(options[1].group, None);
    }

    #[test]
    fn gemini_legacy_models_and_modes_parse() {
        let mut controls = SessionControls::default();
        controls.merge(&json!({
            "modes": {"currentModeId": "default", "availableModes": [
                {"id": "default", "name": "Default"}, {"id": "yolo", "name": "YOLO"}]},
            "models": {"currentModelId": "gemini-3-pro", "availableModels": [
                {"modelId": "gemini-3-pro", "name": "Gemini 3 Pro"}]},
        }));
        assert!(controls.legacy_models);
        assert_eq!(controls.model_id.as_deref(), Some("gemini-3-pro"));
        assert_eq!(controls.mode_id.as_deref(), Some("default"));
        assert!(controls.modes[1].blocked);
        assert!(controls.allows_mode("yolo").is_err());
        assert!(controls.allows_mode("default").is_ok());
    }

    #[test]
    fn a_session_in_a_blocked_mode_is_told_where_to_go() {
        let mut controls = SessionControls::default();
        let mut start = claude();
        start["configOptions"][0]["currentValue"] = json!("bypassPermissions");
        controls.merge(&start);
        let blocked = controls.blocked_mode(None).unwrap();
        assert_eq!(blocked.name, "Bypass permissions");
        assert_eq!(
            blocked.switch,
            Some(ModeSwitch {
                config_id: Some("mode".into()),
                to: "default".into()
            })
        );
        // The mode the user last chose comes first, when it is allowed.
        let blocked = controls.blocked_mode(Some("plan")).unwrap();
        assert_eq!(blocked.switch.unwrap().to, "plan");
        let blocked = controls.blocked_mode(Some("bypassPermissions")).unwrap();
        assert_eq!(blocked.switch.unwrap().to, "default");
        // In a mode that is fine, there is nothing to do.
        controls.merge(&claude());
        assert_eq!(controls.blocked_mode(None), None);
    }

    #[test]
    fn legacy_modes_are_checked_too_and_a_dead_end_is_reported() {
        let mut controls = SessionControls::default();
        controls.merge(
            &json!({"modes": {"currentModeId": "yolo", "availableModes": [
            {"id": "default", "name": "Default"}, {"id": "yolo", "name": "YOLO"}]}}),
        );
        let blocked = controls.blocked_mode(None).unwrap();
        assert_eq!(
            blocked.switch,
            Some(ModeSwitch {
                config_id: None,
                to: "default".into()
            })
        );
        controls.merge(
            &json!({"modes": {"currentModeId": "yolo", "availableModes": [
            {"id": "yolo", "name": "YOLO"}]}}),
        );
        let stuck = controls.blocked_mode(None).unwrap();
        assert_eq!((stuck.name.as_str(), stuck.switch), ("YOLO", None));
    }

    #[test]
    fn current_mode_update_moves_the_mode() {
        let mut controls = SessionControls::default();
        controls.apply_update(
            &json!({"sessionUpdate": "current_mode_update", "currentModeId": "plan"}),
        );
        assert_eq!(controls.mode_id.as_deref(), Some("plan"));
    }

    #[test]
    fn bypass_choices_are_blocked() {
        assert!(is_bypass_choice("bypassPermissions", "Bypass permissions"));
        assert!(is_bypass_choice("agent-full-access", "Full access"));
        assert!(is_bypass_choice("yolo", "YOLO"));
        assert!(is_bypass_choice("danger-full-access", "Danger"));
    }

    #[test]
    fn plan_auto_and_accept_edits_are_not_blocked() {
        for (value, name) in [
            ("plan", "Plan"),
            ("auto", "Auto"),
            ("acceptEdits", "Accept edits"),
        ] {
            assert!(!is_bypass_choice(value, name), "{value}");
        }
    }

    #[test]
    fn boolean_values_serialize_as_typed_objects() {
        let value = ConfigValue::boolean(true);
        assert_eq!(
            serde_json::to_value(&value).unwrap(),
            json!({"type": "boolean", "value": true})
        );
        let params = set_config_option_params("s", "fast", &value);
        assert_eq!(
            params,
            json!({"sessionId": "s", "configId": "fast", "type": "boolean", "value": true})
        );
        let id: ConfigValue = serde_json::from_value(json!("high")).unwrap();
        assert_eq!(id, ConfigValue::Id("high".into()));
    }

    #[test]
    fn allows_rejects_unknown_ids_values_and_blocked_choices() {
        let mut controls = SessionControls::default();
        controls.merge(&claude());
        assert!(controls
            .allows("effort", &ConfigValue::Id("high".into()))
            .is_ok());
        assert!(controls
            .allows("effort", &ConfigValue::Id("ultra".into()))
            .is_err());
        assert!(controls
            .allows("missing", &ConfigValue::Id("x".into()))
            .is_err());
        assert!(controls.allows("fast", &ConfigValue::boolean(true)).is_ok());
        assert!(controls
            .allows("fast", &ConfigValue::Id("true".into()))
            .is_err());
        assert_eq!(
            controls
                .allows("mode", &ConfigValue::Id("bypassPermissions".into()))
                .unwrap_err(),
            "Oleafly keeps permission checks on, so this mode is not available."
        );
    }

    #[test]
    fn more_than_32_options_are_cut_to_32() {
        let options: Vec<Value> = (0..40)
            .map(|index| json!({"id": format!("o{index}"), "name": "x", "type": "boolean", "currentValue": false}))
            .collect();
        let mut controls = SessionControls::default();
        controls.merge(&json!({"configOptions": options}));
        assert_eq!(controls.options.len(), 32);
    }

    #[test]
    fn records_saved_by_0_4_7_still_load() {
        let controls: SessionControls = serde_json::from_value(json!({
            "models": [{"modelId": "opus", "name": "Opus"}], "modelId": "opus", "modelConfigId": null
        }))
        .unwrap();
        assert!(controls.options.is_empty() && controls.modes.is_empty());
    }
}
