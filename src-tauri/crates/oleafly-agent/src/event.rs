use serde::{Deserialize, Serialize};

use crate::complete::Usage;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AgentEvent {
    TextDelta { text: String },
    ReasoningDelta { text: String },
    ToolCallStart { id: String, name: String },
    ToolCallArgsDelta { id: String, json: String },
    ToolCallEnd { id: String, arguments: String },
    Usage { usage: Usage },
    Done { stop_reason: Option<String> },
    Error { message: String, retryable: bool },
}

#[cfg(test)]
mod tests {
    use super::*;

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
