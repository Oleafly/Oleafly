use serde::{Deserialize, Serialize};

use crate::complete::Usage;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentEvent {
    StepStart {
        step: u32,
    },
    Retry {
        attempt: u32,
        max: u32,
    },
    ToolRequest {
        id: String,
        name: String,
        arguments: String,
    },
    ToolOutcome {
        id: String,
        output: String,
    },
    TextDelta {
        text: String,
    },
    ReasoningDelta {
        text: String,
    },
    ToolCallStart {
        id: String,
        name: String,
    },
    ToolCallArgsDelta {
        id: String,
        json: String,
    },
    ToolCallEnd {
        id: String,
        arguments: String,
    },
    Usage {
        usage: Usage,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        last_step: Option<Usage>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        context_window: Option<u32>,
    },
    Notice {
        code: String,
        #[serde(default)]
        detail: Option<String>,
    },
    SubagentUpdate {
        id: String,
        label: String,
        state: String,
        detail: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        runtime: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        provider_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        model_id: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent_id: Option<String>,
    },
    Compacted {
        dropped_messages: u32,
        reason: String,
    },
    Steered {
        text: String,
    },
    Done {
        stop_reason: Option<String>,
    },
    Error {
        message: String,
        retryable: bool,
    },
    RunEnd,
}

impl AgentEvent {
    pub fn usage(usage: Usage) -> Self {
        AgentEvent::Usage {
            usage,
            last_step: None,
            context_window: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_events_carry_the_last_step_and_window_in_camel_case() {
        let event = AgentEvent::Usage {
            usage: Usage::default(),
            last_step: Some(Usage {
                input: 9,
                input_known: Some(true),
                ..Usage::default()
            }),
            context_window: Some(200_000),
        };
        let json = serde_json::to_value(event).unwrap();
        assert_eq!(json["lastStep"]["input"], 9);
        assert_eq!(json["contextWindow"], 200_000);
        let plain = serde_json::to_value(AgentEvent::usage(Usage::default())).unwrap();
        assert!(plain.get("lastStep").is_none() && plain.get("contextWindow").is_none());
    }

    #[test]
    fn notices_serialize_with_kind_notice() {
        let json = serde_json::to_value(AgentEvent::Notice {
            code: "attachment_skipped".into(),
            detail: Some("a.heic".into()),
        })
        .unwrap();
        assert_eq!(
            (
                json["kind"].as_str(),
                json["code"].as_str(),
                json["detail"].as_str()
            ),
            (Some("notice"), Some("attachment_skipped"), Some("a.heic"))
        );
    }

    #[test]
    fn events_serialize_with_a_discriminant_the_frontend_can_switch_on() {
        let json = serde_json::to_value(AgentEvent::TextDelta { text: "hi".into() }).unwrap();
        assert_eq!(json["kind"], "textDelta");
        assert_eq!(json["text"], "hi");

        let json = serde_json::to_value(AgentEvent::ToolCallArgsDelta {
            id: "call_1".into(),
            json: "{\"pa".into(),
        })
        .unwrap();
        assert_eq!(json["kind"], "toolCallArgsDelta");
        assert_eq!(json["id"], "call_1");
    }

    #[test]
    fn every_field_reaches_the_frontend_in_camel_case() {
        let json = serde_json::to_value(AgentEvent::Done {
            stop_reason: Some("stop".into()),
        })
        .unwrap();
        let object = json.as_object().unwrap();
        assert_eq!(object["kind"], "done");
        assert_eq!(object["stopReason"], "stop");
        assert!(!object.contains_key("stop_reason"));

        let json = serde_json::to_value(AgentEvent::Error {
            message: "boom".into(),
            retryable: true,
        })
        .unwrap();
        assert_eq!(json["retryable"], true);
    }

    #[test]
    fn done_without_a_stop_reason_stays_valid() {
        let json = serde_json::to_value(AgentEvent::Done { stop_reason: None }).unwrap();
        let object = json.as_object().unwrap();
        assert_eq!(object["kind"], "done");
        assert!(object["stopReason"].is_null());
    }
}
