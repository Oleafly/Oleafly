//! CLI-agent preferences kept in `sessions.sqlite`: the Experimental
//! switches, how long a silent agent may run, what each agent remembers
//! (effort, mode, the Oleafly key it is routed through), per-project
//! agent settings and what each agent reported about itself.
use serde::{Deserialize, Serialize};
use std::time::Duration;

use oleafly_acp::{capabilities::AuthMethod, Negotiated, ProtocolVersion};

pub const PREFERENCES_KEY: &str = "acp";
pub const MIN_INACTIVITY_MINUTES: u32 = 5;
pub const MAX_INACTIVITY_MINUTES: u32 = 240;
const MAX_CHOICE_NAME: usize = 120;
const MAX_CHOICE_VALUE: usize = 256;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AcpPreferences {
    /// "Use ACP v2 when available".
    pub experimental_v2: bool,
    /// "Let agents use my Oleafly API keys".
    pub experimental_providers: bool,
    /// Minutes an agent may send nothing before Oleafly stops it.
    pub inactivity_minutes: u32,
}

impl Default for AcpPreferences {
    fn default() -> Self {
        Self {
            experimental_v2: false,
            experimental_providers: false,
            inactivity_minutes: 20,
        }
    }
}

impl AcpPreferences {
    pub fn normalized(mut self) -> Self {
        self.inactivity_minutes = self
            .inactivity_minutes
            .clamp(MIN_INACTIVITY_MINUTES, MAX_INACTIVITY_MINUTES);
        self
    }

    pub fn inactivity(&self) -> Duration {
        let minutes = self
            .inactivity_minutes
            .clamp(MIN_INACTIVITY_MINUTES, MAX_INACTIVITY_MINUTES);
        Duration::from_secs(u64::from(minutes) * 60)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentPreferences {
    pub effort: Option<RememberedChoice>,
    pub mode: Option<RememberedChoice>,
    /// The Oleafly provider whose key this agent is routed through.
    pub provider: Option<String>,
}

impl AgentPreferences {
    /// Bounds what a window may store.
    pub fn normalized(mut self) -> Self {
        for choice in [&mut self.effort, &mut self.mode] {
            if let Some(value) = choice {
                if value.value.is_empty() || value.value.len() > MAX_CHOICE_VALUE {
                    *choice = None;
                } else {
                    value.name = value.name.chars().take(MAX_CHOICE_NAME).collect();
                }
            }
        }
        self.provider = self
            .provider
            .filter(|id| !id.is_empty() && id.len() <= 64)
            .filter(|id| {
                id.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_-.:".contains(c))
            });
        self
    }
}

/// A choice Oleafly applies to new sessions; `name` is shown in Settings.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedChoice {
    pub value: String,
    pub name: String,
}

impl RememberedChoice {
    pub fn new(value: &str, name: &str, redactor: &oleafly_acp::redact::Redactor) -> Self {
        Self {
            value: value.to_owned(),
            name: redactor
                .text(name)
                .chars()
                .filter(|c| !c.is_control())
                .take(MAX_CHOICE_NAME)
                .collect(),
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ProjectAgentSettings {
    pub hermes: Option<super::hermes::HermesSettings>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", default)]
pub struct AgentRuntimeInfo {
    pub protocol: u16,
    pub protocol_label: String,
    pub providers: bool,
    pub providers_supported: Vec<String>,
    pub steering: bool,
    pub session_list: bool,
    pub session_fork: bool,
    pub session_delete: bool,
    pub logout: bool,
    pub auth_methods: Vec<AuthMethod>,
    pub checked_at: u64,
}

pub fn protocol_label(protocol: ProtocolVersion) -> String {
    match protocol {
        ProtocolVersion::V1 => "ACP v1".into(),
        ProtocolVersion::V2 => format!("ACP v2 (draft {})", oleafly_acp::v2::DRAFT_VERSION),
    }
}

impl AgentRuntimeInfo {
    /// What an `initialize` answer says, with agent-written texts redacted.
    pub fn from_negotiated(
        negotiated: &Negotiated,
        auth_methods: Vec<AuthMethod>,
        checked_at: u64,
    ) -> Self {
        let caps = &negotiated.capabilities;
        Self {
            protocol: negotiated.protocol.number(),
            protocol_label: protocol_label(negotiated.protocol),
            providers: caps.providers,
            providers_supported: Vec::new(),
            steering: caps.steering,
            session_list: caps.list,
            session_fork: caps.fork,
            session_delete: caps.delete,
            logout: caps.logout,
            auth_methods,
            checked_at,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inactivity_is_clamped() {
        let low = AcpPreferences {
            inactivity_minutes: 0,
            ..Default::default()
        }
        .normalized();
        assert_eq!(low.inactivity_minutes, 5);
        let high = AcpPreferences {
            inactivity_minutes: 999,
            ..Default::default()
        }
        .normalized();
        assert_eq!(high.inactivity_minutes, 240);
        assert_eq!(
            AcpPreferences::default().inactivity(),
            Duration::from_secs(20 * 60)
        );
    }

    #[test]
    fn agent_preferences_drop_oversized_values_and_bad_provider_ids() {
        let prefs = AgentPreferences {
            effort: Some(RememberedChoice {
                value: "x".repeat(300),
                name: "Huge".into(),
            }),
            mode: Some(RememberedChoice {
                value: "plan".into(),
                name: "P".repeat(200),
            }),
            provider: Some("bad id".into()),
        }
        .normalized();
        assert!(prefs.effort.is_none());
        assert_eq!(prefs.mode.unwrap().name.chars().count(), 120);
        assert!(prefs.provider.is_none());
    }
}
