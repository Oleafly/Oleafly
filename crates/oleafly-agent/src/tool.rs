use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolSchema {
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub input_schema: Value,
}

pub fn openai_tools(tools: &[ToolSchema]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "function": {
                        "name": tool.name,
                        "description": tool.description,
                        "parameters": tool.input_schema,
                    }
                })
            })
            .collect(),
    )
}

pub fn openai_responses_tools(tools: &[ToolSchema]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|tool| {
                json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": tool.input_schema,
                })
            })
            .collect(),
    )
}

pub fn anthropic_tools(tools: &[ToolSchema]) -> Value {
    Value::Array(
        tools
            .iter()
            .map(|tool| {
                json!({
                    "name": tool.name,
                    "description": tool.description,
                    "input_schema": tool.input_schema,
                })
            })
            .collect(),
    )
}

pub fn google_tools(tools: &[ToolSchema]) -> Value {
    let declarations: Vec<Value> = tools
        .iter()
        .map(|tool| {
            json!({
                "name": tool.name,
                "description": tool.description,
                "parametersJsonSchema": tool.input_schema,
            })
        })
        .collect();
    json!([{ "functionDeclarations": declarations }])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Vec<ToolSchema> {
        vec![ToolSchema {
            name: "read_file".into(),
            description: "Read a file".into(),
            input_schema: json!({
                "type": "object",
                "properties": { "path": { "type": "string", "default": "main.tex" } },
                "required": ["path"],
                "additionalProperties": false
            }),
        }]
    }

    #[test]
    fn openai_wraps_each_tool_in_a_function_envelope() {
        let out = openai_tools(&sample());
        assert_eq!(out[0]["type"], "function");
        assert_eq!(out[0]["function"]["name"], "read_file");
        assert_eq!(out[0]["function"]["parameters"]["required"][0], "path");
    }

    #[test]
    fn openai_responses_puts_function_fields_at_the_top_level() {
        let out = openai_responses_tools(&sample());
        assert_eq!(out[0]["type"], "function");
        assert_eq!(out[0]["name"], "read_file");
        assert_eq!(out[0]["parameters"]["required"][0], "path");
        assert!(out[0].get("function").is_none());
    }

    #[test]
    fn anthropic_uses_input_schema_at_the_top_level() {
        let out = anthropic_tools(&sample());
        assert_eq!(out[0]["name"], "read_file");
        assert_eq!(out[0]["input_schema"]["type"], "object");
        assert!(out[0].get("function").is_none());
    }

    #[test]
    fn google_nests_declarations_and_uses_arbitrary_json_schema() {
        let out = google_tools(&sample());
        let declaration = &out[0]["functionDeclarations"][0];
        assert_eq!(declaration["name"], "read_file");
        assert!(declaration.get("parameters").is_none());
        assert_eq!(
            declaration["parametersJsonSchema"]["additionalProperties"],
            false
        );
        assert_eq!(
            declaration["parametersJsonSchema"]["properties"]["path"]["default"],
            "main.tex"
        );
        assert_eq!(
            declaration["parametersJsonSchema"]["properties"]["path"]["type"],
            "string"
        );
    }

    #[test]
    fn google_preserves_defs_refs_composition_and_const() {
        let schema = json!({
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "$defs": {
                "target": {
                    "oneOf": [
                        {"type": "string", "const": "main.tex"},
                        {"type": "string", "pattern": "^[a-z]+\\.tex$"}
                    ]
                }
            },
            "properties": {
                "path": {"$ref": "#/$defs/target"}
            },
            "required": ["path"]
        });
        let tools = vec![ToolSchema {
            name: "select_target".into(),
            description: "Select a target".into(),
            input_schema: schema.clone(),
        }];

        let out = google_tools(&tools);

        assert_eq!(
            out[0]["functionDeclarations"][0]["parametersJsonSchema"],
            schema
        );
    }

    #[test]
    fn an_empty_tool_list_still_produces_the_right_container() {
        assert_eq!(openai_tools(&[]), json!([]));
        assert_eq!(anthropic_tools(&[]), json!([]));
        assert_eq!(google_tools(&[])[0]["functionDeclarations"], json!([]));
    }
}
