use super::*;
use crate::caps::{BudgetRange, ModelCaps, ReasoningCaps};
use crate::complete::{with_blocking_ceiling, CompletionRequest, WebTools};
use crate::effort::Effort;
use crate::message::{ContentPart, ProviderWire};
use crate::provider::{ANTHROPIC_BASE, GOOGLE_BASE, OPENAI_BASE};
use crate::wire::server_tools::anthropic_web_versions;

fn resolved(wire: Wire) -> Resolved {
    Resolved {
        provider_id: "test".into(),
        model_id: "m-1".into(),
        credential: "sk-test".into(),
        auth: Some("sk-test".into()),
        wire,
        caps: crate::caps::ModelCaps::default(),
    }
}
fn openai() -> Resolved {
    resolved(Wire::OpenAiChat {
        base_url: OPENAI_BASE.into(),
        reasoning_content: false,
    })
}

fn google() -> Resolved {
    Resolved {
        model_id: "gemini-3.7-flash".into(),
        ..resolved(Wire::Google {
            base_url: GOOGLE_BASE.into(),
        })
    }
}

fn openai_responses() -> Resolved {
    resolved(Wire::OpenAiResponses {
        base_url: OPENAI_BASE.into(),
    })
}

fn vision_request() -> CompletionRequest {
    CompletionRequest {
        system: Some("transcribe".into()),
        messages: vec![Message {
            role: Role::User,
            content: vec![
                ContentPart::text("What is this?"),
                ContentPart::Image {
                    image: "data:image/png;base64,AAAB".into(),
                },
            ],
        }],
        ..Default::default()
    }
}

#[test]
fn a_single_text_part_goes_out_as_a_bare_string() {
    let body = openai_body(&openai(), &CompletionRequest::prompt("sys", "hi")).unwrap();
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["content"], json!("hi"));
}

#[test]
fn an_empty_system_prompt_is_omitted_everywhere() {
    let mut req = CompletionRequest::prompt("", "hi");
    assert_eq!(
        openai_body(&openai(), &req).unwrap()["messages"][0]["role"],
        "user"
    );
    assert!(anthropic_body(&openai(), &req)
        .unwrap()
        .get("system")
        .is_none());
    assert!(google_body(&google(), &req)
        .unwrap()
        .get("systemInstruction")
        .is_none());

    req.system = None;
    assert_eq!(
        openai_body(&openai(), &req).unwrap()["messages"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
}

#[test]
fn images_take_each_providers_own_shape() {
    let req = vision_request();

    let oa = openai_body(&openai(), &req).unwrap();
    assert_eq!(oa["messages"][1]["content"][1]["type"], "image_url");
    assert_eq!(
        oa["messages"][1]["content"][1]["image_url"]["url"],
        "data:image/png;base64,AAAB"
    );

    let an = anthropic_body(&openai(), &req).unwrap();
    assert_eq!(
        an["messages"][0]["content"][1]["source"]["media_type"],
        "image/png"
    );
    assert_eq!(an["messages"][0]["content"][1]["source"]["data"], "AAAB");

    let gg = google_body(&google(), &req).unwrap();
    assert_eq!(
        gg["contents"][0]["parts"][1]["inlineData"]["mimeType"],
        "image/png"
    );
    assert_eq!(gg["contents"][0]["parts"][1]["inlineData"]["data"], "AAAB");
}

#[test]
fn a_remote_image_url_is_refused_before_any_request_leaves() {
    let req = CompletionRequest {
        messages: vec![Message {
            role: Role::User,
            content: vec![
                ContentPart::text("look"),
                ContentPart::Image {
                    image: "https://example.com/x.png".into(),
                },
            ],
        }],
        ..Default::default()
    };
    assert!(openai_body(&openai(), &req).is_err());
    assert!(anthropic_body(&openai(), &req).is_err());
    assert!(google_body(&google(), &req).is_err());
}

fn tool_turn() -> CompletionRequest {
    CompletionRequest {
        system: Some("sys".into()),
        messages: vec![
            Message::user("read main.tex"),
            Message {
                role: Role::Assistant,
                content: vec![
                    ContentPart::text("Reading it now."),
                    ContentPart::ToolUse {
                        id: "call_1".into(),
                        name: "read_file".into(),
                        arguments: "{\"path\":\"main.tex\"}".into(),
                        thought_signature: Some("sig-abc".into()),
                    },
                ],
            },
            Message {
                role: Role::User,
                content: vec![ContentPart::ToolResult {
                    id: "call_1".into(),
                    name: "read_file".into(),
                    output: "\\documentclass{article}".into(),
                    images: Vec::new(),
                }],
            },
        ],
        tools: vec![crate::tool::ToolSchema {
            name: "read_file".into(),
            description: "Read a file".into(),
            input_schema: json!({"type":"object","properties":{}}),
        }],
        ..Default::default()
    }
}

#[test]
fn openai_puts_tool_calls_on_the_assistant_and_results_in_their_own_messages() {
    let body = openai_body(&openai(), &tool_turn()).unwrap();
    let messages = body["messages"].as_array().unwrap();

    assert_eq!(messages[0]["role"], "system");
    assert_eq!(messages[1]["role"], "user");

    let assistant = &messages[2];
    assert_eq!(assistant["role"], "assistant");
    assert_eq!(assistant["content"], "Reading it now.");
    assert_eq!(assistant["tool_calls"][0]["id"], "call_1");
    assert_eq!(assistant["tool_calls"][0]["function"]["name"], "read_file");
    assert_eq!(
        assistant["tool_calls"][0]["function"]["arguments"],
        "{\"path\":\"main.tex\"}"
    );

    let result = &messages[3];
    assert_eq!(result["role"], "tool");
    assert_eq!(result["tool_call_id"], "call_1");
    assert_eq!(result["content"], "\\documentclass{article}");
    assert_eq!(messages.len(), 4);
}

#[test]
fn responses_api_preserves_messages_function_calls_and_outputs_in_order() {
    let body = openai_responses_body(&openai_responses(), &tool_turn()).unwrap();
    let input = body["input"].as_array().unwrap();

    assert_eq!(body["instructions"], "sys");
    assert_eq!(body["store"], false);
    assert_eq!(body["include"][0], "reasoning.encrypted_content");
    assert_eq!(input[0]["type"], "message");
    assert_eq!(input[0]["role"], "user");
    assert_eq!(input[0]["content"][0]["type"], "input_text");
    assert_eq!(input[1]["role"], "assistant");
    assert_eq!(input[1]["content"][0]["type"], "output_text");
    assert_eq!(input[2]["type"], "function_call");
    assert_eq!(input[2]["call_id"], "call_1");
    assert_eq!(input[2]["name"], "read_file");
    assert_eq!(input[3]["type"], "function_call_output");
    assert_eq!(input[3]["call_id"], "call_1");
    assert_eq!(body["tools"][0]["type"], "function");
    assert_eq!(body["tools"][0]["name"], "read_file");
    assert!(body["tools"][0].get("function").is_none());
}

#[test]
fn responses_api_replays_opaque_provider_items_for_stateless_tool_continuations() {
    let mut request = CompletionRequest::prompt("sys", "this generic history is replaced");
    request.openai_responses_input = Some(vec![json!({
        "type": "reasoning",
        "id": "rs_1",
        "encrypted_content": "opaque",
    })]);
    let body = openai_responses_body(&openai_responses(), &request).unwrap();
    assert_eq!(body["input"].as_array().unwrap().len(), 1);
    assert_eq!(body["input"][0]["type"], "reasoning");
    assert_eq!(body["input"][0]["encrypted_content"], "opaque");
}

#[test]
fn responses_api_uses_input_images_and_renames_the_token_limit() {
    let mut request = vision_request();
    request.max_tokens = Some(123);
    let body = openai_responses_body(&openai_responses(), &request).unwrap();
    assert_eq!(body["input"][0]["content"][1]["type"], "input_image");
    assert_eq!(
        body["input"][0]["content"][1]["image_url"],
        "data:image/png;base64,AAAB"
    );
    assert_eq!(body["max_output_tokens"], 123);
    assert!(body.get("max_tokens").is_none());
}

#[test]
fn official_openai_requests_use_the_responses_endpoint() {
    let client = reqwest::Client::new();
    let request = request_builder(&client, &openai_responses(), true)
        .build()
        .unwrap();
    assert_eq!(
        request.url().as_str(),
        "https://api.openai.com/v1/responses"
    );
}

#[test]
fn a_tool_result_only_turn_produces_no_empty_user_message() {
    let request = CompletionRequest {
        messages: vec![Message {
            role: Role::User,
            content: vec![ContentPart::ToolResult {
                id: "c".into(),
                name: "n".into(),
                output: "out".into(),
                images: Vec::new(),
            }],
        }],
        ..Default::default()
    };
    let body = openai_body(&openai(), &request).unwrap();
    let messages = body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["role"], "tool");
}

#[test]
fn an_assistant_turn_of_only_tool_calls_sends_null_content() {
    let request = CompletionRequest {
        messages: vec![Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: "c".into(),
                name: "n".into(),
                arguments: "{}".into(),
                thought_signature: None,
            }],
        }],
        ..Default::default()
    };
    let body = openai_body(&openai(), &request).unwrap();
    assert!(body["messages"][0]["content"].is_null());
    assert_eq!(body["messages"][0]["tool_calls"][0]["id"], "c");
}

#[test]
fn anthropic_keeps_tool_blocks_inside_the_turn_and_parses_arguments() {
    let body = anthropic_body(&openai(), &tool_turn()).unwrap();
    let messages = body["messages"].as_array().unwrap();

    let assistant = &messages[1];
    assert_eq!(assistant["content"][0]["type"], "text");
    assert_eq!(assistant["content"][1]["type"], "tool_use");
    assert_eq!(assistant["content"][1]["id"], "call_1");
    assert_eq!(assistant["content"][1]["input"]["path"], "main.tex");

    let result = &messages[2];
    assert_eq!(result["role"], "user");
    assert_eq!(result["content"][0]["type"], "tool_result");
    assert_eq!(result["content"][0]["tool_use_id"], "call_1");
}

#[test]
fn google_uses_function_call_and_response_parts() {
    let body = google_body(&google(), &tool_turn()).unwrap();
    let contents = body["contents"].as_array().unwrap();

    assert_eq!(contents[1]["role"], "model");
    assert_eq!(contents[1]["parts"][1]["functionCall"]["name"], "read_file");
    assert_eq!(
        contents[1]["parts"][1]["functionCall"]["args"]["path"],
        "main.tex"
    );

    assert_eq!(contents[2]["role"], "user");
    assert_eq!(
        contents[2]["parts"][0]["functionResponse"]["name"],
        "read_file"
    );
}

#[test]
fn google_echoes_the_thought_signature_beside_its_function_call() {
    let body = google_body(&google(), &tool_turn()).unwrap();
    assert_eq!(
        body["contents"][1]["parts"][1]["thoughtSignature"],
        "sig-abc"
    );
}

#[test]
fn a_function_call_without_a_signature_omits_the_field_entirely() {
    let request = CompletionRequest {
        messages: vec![Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: "c".into(),
                name: "n".into(),
                arguments: "{}".into(),
                thought_signature: None,
            }],
        }],
        ..Default::default()
    };
    let part = &google_body(&google(), &request).unwrap()["contents"][0]["parts"][0];
    assert!(part.get("thoughtSignature").is_none());
}

#[test]
fn thought_signatures_never_leak_into_other_providers_wire_shapes() {
    let request = tool_turn();
    let openai_call = &openai_body(&openai(), &request).unwrap()["messages"][2]["tool_calls"][0];
    assert!(openai_call.get("thoughtSignature").is_none());

    let anthropic_block =
        &anthropic_body(&openai(), &request).unwrap()["messages"][1]["content"][1];
    assert!(anthropic_block.get("thoughtSignature").is_none());

    let responses_item = &openai_responses_body(&openai_responses(), &request).unwrap()["input"][2];
    assert!(responses_item.get("thoughtSignature").is_none());
}

#[test]
fn tool_schemas_reach_every_provider_in_its_own_shape() {
    let request = tool_turn();
    assert_eq!(
        openai_body(&openai(), &request).unwrap()["tools"][0]["function"]["name"],
        "read_file"
    );
    assert_eq!(
        anthropic_body(&openai(), &request).unwrap()["tools"][0]["name"],
        "read_file"
    );
    assert_eq!(
        google_body(&google(), &request).unwrap()["tools"][0]["functionDeclarations"][0]["name"],
        "read_file"
    );
}

#[test]
fn google_request_preserves_arbitrary_json_tool_schema() {
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
        "properties": {"path": {"$ref": "#/$defs/target"}},
        "required": ["path"]
    });
    let request = CompletionRequest {
        tools: vec![crate::tool::ToolSchema {
            name: "select_target".into(),
            description: "Select a target".into(),
            input_schema: schema.clone(),
        }],
        ..CompletionRequest::prompt("sys", "choose")
    };

    let body = google_body(&google(), &request).unwrap();
    let declaration = &body["tools"][0]["functionDeclarations"][0];

    assert!(declaration.get("parameters").is_none());
    assert_eq!(declaration["parametersJsonSchema"], schema);
}

#[test]
fn a_request_without_tools_sends_no_tools_field() {
    let request = CompletionRequest::prompt("s", "u");
    assert!(openai_body(&openai(), &request)
        .unwrap()
        .get("tools")
        .is_none());
    assert!(anthropic_body(&openai(), &request)
        .unwrap()
        .get("tools")
        .is_none());
    assert!(google_body(&google(), &request)
        .unwrap()
        .get("tools")
        .is_none());
}

#[test]
fn truncated_tool_arguments_do_not_break_the_request() {
    let request = CompletionRequest {
        messages: vec![Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: "c".into(),
                name: "n".into(),
                arguments: "{\"path\":".into(),
                thought_signature: None,
            }],
        }],
        ..Default::default()
    };
    assert_eq!(
        anthropic_body(&openai(), &request).unwrap()["messages"][0]["content"][0]["input"],
        json!({})
    );
}

#[test]
fn anthropic_sends_temperature_only_to_claude_models_that_accept_it() {
    let req = CompletionRequest {
        temperature: Some(0.4),
        ..CompletionRequest::prompt("s", "u")
    };
    let body_for = |model: &str| {
        let claude = Resolved {
            model_id: model.into(),
            ..resolved(Wire::Anthropic {
                base_url: ANTHROPIC_BASE.into(),
            })
        };
        anthropic_body(&claude, &req).unwrap()
    };

    for model in [
        "claude-opus-5-5",
        "claude-sonnet-5-5",
        "claude-haiku-5-5",
        "claude-fable-5-1",
        "claude-opus-5",
        "claude-sonnet-5",
        "claude-opus-4-8",
        "claude-opus-4-7",
    ] {
        assert!(
            body_for(model).get("temperature").is_none(),
            "{model} answers a temperature with a 400"
        );
    }
    for model in [
        "claude-haiku-4-5",
        "claude-haiku-4-5-20251001",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-sonnet-4-20250514",
        "claude-opus-4-1-20250805",
        "claude-3-5-haiku-20241022",
        "m-1",
    ] {
        assert_eq!(
            body_for(model)["temperature"],
            json!(0.4_f32),
            "{model} still takes a temperature"
        );
    }
}

#[test]
fn openai_reasoning_models_get_no_temperature() {
    let req = CompletionRequest {
        temperature: Some(0.4),
        ..CompletionRequest::prompt("s", "u")
    };
    let body_for = |model: &str| {
        let openai = Resolved {
            model_id: model.into(),
            ..openai_responses()
        };
        openai_responses_body(&openai, &req).unwrap()
    };

    for model in [
        "gpt-6.1-sol",
        "gpt-6-luna",
        "gpt-5.6-terra",
        "gpt-5",
        "o3",
        "o4-mini",
    ] {
        assert!(
            body_for(model).get("temperature").is_none(),
            "{model} refuses a temperature"
        );
    }
    for model in ["gpt-4o", "gpt-4o-mini", "gpt-4.1-mini", "chatgpt-4o-latest"] {
        assert_eq!(
            body_for(model)["temperature"],
            json!(0.4_f32),
            "{model} still takes a temperature"
        );
    }
}

#[test]
fn gemini_3_and_later_get_no_temperature_and_gemini_4_gets_a_thinking_level() {
    let req = CompletionRequest {
        temperature: Some(0.4),
        ..CompletionRequest::prompt("s", "u")
    };
    let config_for = |model: &str| {
        let gemini = Resolved {
            model_id: model.into(),
            ..google()
        };
        google_body(&gemini, &req).unwrap()["generationConfig"].clone()
    };

    for model in ["gemini-3.8-flash", "gemini-4-argon", "gemini-flash-latest"] {
        assert!(
            config_for(model).get("temperature").is_none(),
            "{model} gets no temperature"
        );
    }
    for model in ["gemini-2.5-flash", "gemma-3-27b-it"] {
        assert_eq!(config_for(model)["temperature"], json!(0.4_f32), "{model}");
    }

    assert_eq!(
        config_for("gemini-4-argon")["thinkingConfig"],
        json!({ "includeThoughts": true, "thinkingLevel": "medium" })
    );
    assert_eq!(
        config_for("gemini-3.8-flash")["thinkingConfig"],
        json!({ "includeThoughts": true })
    );
}

fn deepseek() -> Resolved {
    Resolved {
        provider_id: "deepseek".into(),
        model_id: "deepseek-flash".into(),
        caps: ModelCaps::from_metadata_json(&json!({
            "outputLimit": 393216,
            "reasoning": true,
            "reasoningOptions": [{"type":"toggle"},{"type":"effort","values":["low","high","max"]}]
        })),
        ..resolved(Wire::OpenAiChat {
            base_url: "https://api.deepseek.com".into(),
            reasoning_content: true,
        })
    }
}

fn reasoned_tool_turn() -> CompletionRequest {
    let mut request = tool_turn();
    request.messages[1].content.insert(
        0,
        ContentPart::Reasoning {
            text: "main.tex holds the preamble.".into(),
        },
    );
    request
}

fn thinking_fields(resolved: &Resolved, request: &CompletionRequest) -> Value {
    let body = openai_body(resolved, request).unwrap();
    json!({
        "thinking": body.get("thinking"),
        "reasoning_effort": body.get("reasoning_effort"),
        "max_tokens": body.get("max_tokens"),
    })
}

#[test]
fn deepseek_sends_each_assistant_turns_reasoning_back() {
    let body = openai_body(&deepseek(), &reasoned_tool_turn()).unwrap();
    let assistant = &body["messages"][2];
    assert_eq!(assistant["role"], "assistant");
    assert_eq!(
        assistant["reasoning_content"],
        "main.tex holds the preamble."
    );
    assert_eq!(assistant["content"], "Reading it now.");
    assert_eq!(assistant["tool_calls"][0]["id"], "call_1");
    assert!(body["messages"][1].get("reasoning_content").is_none());
}

#[test]
fn custom_endpoints_get_reasoning_back_only_on_hosts_that_expect_it() {
    let custom = |base: &str| Resolved {
        provider_id: "custom-endpoint".into(),
        model_id: "some-model".into(),
        ..resolved(Wire::OpenAiChat {
            base_url: base.into(),
            reasoning_content: true,
        })
    };
    let request = reasoned_tool_turn();
    let strict = openai_body(&custom("https://llm.example.com/v1"), &request).unwrap();
    assert!(strict["messages"][2].get("reasoning_content").is_none());
    for base in [
        "https://api.moonshot.cn/v1",
        "https://open.bigmodel.cn/api/paas/v4",
    ] {
        let body = openai_body(&custom(base), &request).unwrap();
        assert_eq!(
            body["messages"][2]["reasoning_content"], "main.tex holds the preamble.",
            "{base}"
        );
    }
}

#[test]
fn reasoning_parts_reach_only_reasoning_content_chat_wires() {
    let request = reasoned_tool_turn();
    let secret = "main.tex holds the preamble.";
    let bodies = [
        openai_body(&openai(), &request).unwrap(),
        anthropic_body(
            &anthropic_model("claude-opus-5-5", ModelCaps::default()),
            &request,
        )
        .unwrap(),
        google_body(&google(), &request).unwrap(),
        openai_responses_body(&openai_responses(), &request).unwrap(),
    ];
    for body in bodies {
        assert!(!body.to_string().contains(secret), "{body}");
    }
}

#[test]
fn deepseek_thinks_with_tools_when_every_earlier_turn_kept_its_reasoning() {
    let mut fresh = CompletionRequest {
        effort: Some(Effort::High),
        ..CompletionRequest::prompt("s", "u")
    };
    fresh.tools = tool_turn().tools;
    assert_eq!(
        thinking_fields(&deepseek(), &fresh),
        json!({"thinking": {"type": "enabled"}, "reasoning_effort": "high", "max_tokens": null})
    );
    let replayed = CompletionRequest {
        effort: Some(Effort::Max),
        ..reasoned_tool_turn()
    };
    assert_eq!(
        thinking_fields(&deepseek(), &replayed),
        json!({"thinking": {"type": "enabled"}, "reasoning_effort": "max", "max_tokens": null})
    );
}

#[test]
fn deepseek_turns_thinking_off_for_tool_runs_over_history_without_reasoning() {
    let request = CompletionRequest {
        effort: Some(Effort::High),
        ..tool_turn()
    };
    assert_eq!(
        thinking_fields(&deepseek(), &request),
        json!({"thinking": {"type": "disabled"}, "reasoning_effort": null, "max_tokens": 64000})
    );
    let mut without_tools = request;
    without_tools.tools.clear();
    assert_eq!(
        thinking_fields(&deepseek(), &without_tools)["thinking"],
        json!({"type": "enabled"})
    );
}

#[test]
fn deepseek_effort_off_disables_thinking_and_lifts_the_short_default_ceiling() {
    let off = with_effort(Effort::Off);
    assert_eq!(
        thinking_fields(&deepseek(), &off),
        json!({"thinking": {"type": "disabled"}, "reasoning_effort": null, "max_tokens": 64000})
    );
    let capped = CompletionRequest {
        max_tokens: Some(12_000),
        ..with_effort(Effort::Off)
    };
    assert_eq!(thinking_fields(&deepseek(), &capped)["max_tokens"], 12_000);
    let unknown_limit = Resolved {
        caps: ModelCaps::default(),
        ..deepseek()
    };
    assert_eq!(
        thinking_fields(&unknown_limit, &off)["max_tokens"],
        crate::wire::reasoning::FALLBACK_MAX_TOKENS
    );
}

#[test]
fn deepseek_effort_levels_map_the_way_deepseek_documents() {
    for (effort, sent) in [
        (Effort::Minimal, "low"),
        (Effort::Low, "low"),
        (Effort::Medium, "high"),
        (Effort::High, "high"),
        (Effort::Xhigh, "high"),
        (Effort::Max, "max"),
    ] {
        assert_eq!(
            thinking_fields(&deepseek(), &with_effort(effort)),
            json!({"thinking": {"type": "enabled"}, "reasoning_effort": sent, "max_tokens": null}),
            "{effort:?}"
        );
    }
    assert_eq!(
        thinking_fields(&deepseek(), &CompletionRequest::prompt("s", "u")),
        json!({"thinking": {"type": "enabled"}, "reasoning_effort": null, "max_tokens": null})
    );
}

#[test]
fn zai_keeps_its_own_thinking_defaults() {
    let zai = Resolved {
        provider_id: "zai".into(),
        model_id: "glm-5.3".into(),
        ..openai()
    };
    assert!(openai_body(&zai, &tool_turn())
        .unwrap()
        .get("thinking")
        .is_none());
}

#[test]
fn google_renames_the_assistant_turn() {
    let req = CompletionRequest {
        messages: vec![
            Message::user("hi"),
            Message {
                role: Role::Assistant,
                content: vec![ContentPart::text("hello")],
            },
        ],
        ..Default::default()
    };
    let body = google_body(&google(), &req).unwrap();
    assert_eq!(body["contents"][0]["role"], "user");
    assert_eq!(body["contents"][1]["role"], "model");
}

#[test]
fn gemini_models_always_ask_for_streamed_thought_summaries() {
    let req = CompletionRequest::prompt("s", "u");
    let body = google_body(&google(), &req).unwrap();
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["includeThoughts"],
        true
    );
}

#[test]
fn non_gemini_google_models_get_no_generation_config_by_default() {
    let req = CompletionRequest::prompt("s", "u");
    let other = Resolved {
        model_id: "gemma-3-27b-it".into(),
        ..resolved(Wire::Google {
            base_url: GOOGLE_BASE.into(),
        })
    };
    assert!(google_body(&other, &req)
        .unwrap()
        .get("generationConfig")
        .is_none());
}

fn header_names(resolved: &Resolved) -> Vec<String> {
    auth_headers(resolved)
        .keys()
        .map(|k| k.as_str().to_string())
        .collect()
}

fn header_value(resolved: &Resolved, name: &str) -> Option<String> {
    auth_headers(resolved)
        .get(name)
        .map(|v| String::from_utf8_lossy(v.as_bytes()).to_string())
}

#[test]
fn each_wire_authenticates_the_way_its_api_documents() {
    let openai_wire = openai();
    assert_eq!(
        header_value(&openai_wire, "authorization").as_deref(),
        Some("Bearer sk-test")
    );

    let anthropic_wire = resolved(Wire::Anthropic {
        base_url: ANTHROPIC_BASE.into(),
    });
    assert_eq!(
        header_value(&anthropic_wire, "x-api-key").as_deref(),
        Some("sk-test")
    );
    assert!(header_value(&anthropic_wire, "authorization").is_none());

    let google_wire = resolved(Wire::Google {
        base_url: GOOGLE_BASE.into(),
    });
    assert_eq!(
        header_value(&google_wire, "x-goog-api-key").as_deref(),
        Some("sk-test")
    );
}

#[test]
fn a_provider_that_needs_no_credential_gets_no_auth_header() {
    let anonymous = Resolved {
        auth: None,
        ..openai()
    };
    assert!(header_names(&anonymous).is_empty());
}

#[test]
fn the_credential_header_is_marked_sensitive_so_it_stays_out_of_logs() {
    let headers = auth_headers(&openai());
    assert!(headers.get("authorization").unwrap().is_sensitive());
}

#[test]
fn endpoints_are_built_without_double_slashes() {
    for base in [OPENAI_BASE, "http://localhost:8000/v1/"] {
        let url = format!("{}/chat/completions", base.trim_end_matches('/'));
        assert!(!url.contains("//chat"), "bad url {url}");
    }
    assert_eq!(
        format!("{}/messages", ANTHROPIC_BASE.trim_end_matches('/')),
        "https://api.anthropic.com/v1/messages"
    );
    assert_eq!(
        format!(
            "{}/models/{}:generateContent",
            GOOGLE_BASE.trim_end_matches('/'),
            "gemini-3.5-flash-lite"
        ),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent"
    );
}

fn anthropic_model(id: &str, caps: ModelCaps) -> Resolved {
    Resolved {
        provider_id: "anthropic".into(),
        model_id: id.into(),
        caps,
        ..resolved(Wire::Anthropic {
            base_url: ANTHROPIC_BASE.into(),
        })
    }
}

fn reasoning_caps(efforts: &[Effort]) -> ModelCaps {
    ModelCaps {
        reasoning: ReasoningCaps {
            flag: Some(true),
            efforts: Some(efforts.to_vec()),
            ..ReasoningCaps::default()
        },
        ..ModelCaps::default()
    }
}

fn opus_caps() -> ModelCaps {
    ModelCaps {
        output_limit: Some(128_000),
        ..reasoning_caps(&[
            Effort::Low,
            Effort::Medium,
            Effort::High,
            Effort::Xhigh,
            Effort::Max,
        ])
    }
}

fn haiku_caps_with_toggle() -> ModelCaps {
    let mut caps = reasoning_caps(&[
        Effort::Low,
        Effort::Medium,
        Effort::High,
        Effort::Xhigh,
        Effort::Max,
    ]);
    caps.reasoning.toggle = true;
    caps
}

fn responses_model(id: &str, caps: ModelCaps) -> Resolved {
    Resolved {
        provider_id: "openai".into(),
        model_id: id.into(),
        caps,
        ..openai_responses()
    }
}

fn chat(provider: &str, model: &str, caps: ModelCaps) -> Resolved {
    Resolved {
        provider_id: provider.into(),
        model_id: model.into(),
        caps,
        ..openai()
    }
}

fn gemini(id: &str, caps: ModelCaps) -> Resolved {
    Resolved {
        provider_id: "google".into(),
        model_id: id.into(),
        caps,
        ..google()
    }
}

fn flash_25_caps() -> ModelCaps {
    ModelCaps::from_metadata_json(&json!({
        "reasoning": true,
        "reasoningOptions": [{"type":"toggle"},{"type":"budget_tokens","min":0,"max":24576}]
    }))
}

fn pro_25_caps() -> ModelCaps {
    ModelCaps::from_metadata_json(&json!({
        "reasoning": true,
        "reasoningOptions": [{"type":"budget_tokens","min":128,"max":32768}]
    }))
}

fn with_effort(effort: Effort) -> CompletionRequest {
    CompletionRequest {
        effort: Some(effort),
        ..CompletionRequest::prompt("s", "u")
    }
}

fn tool(name: &str) -> crate::tool::ToolSchema {
    crate::tool::ToolSchema {
        name: name.into(),
        description: format!("{name} tool"),
        input_schema: json!({"type":"object","properties":{}}),
    }
}

#[test]
fn anthropic_effort_goes_in_output_config_with_adaptive_thinking() {
    let r = anthropic_model("claude-opus-5-5", opus_caps());
    let body = anthropic_body(
        &r,
        &CompletionRequest {
            effort: Some(Effort::High),
            temperature: Some(0.4),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert_eq!(body["output_config"], json!({"effort":"high"}));
    assert_eq!(body["thinking"], json!({"type":"adaptive"}));
    assert!(body.get("temperature").is_none());
}

#[test]
fn anthropic_auto_effort_thinks_only_where_the_model_does_by_default() {
    let five = anthropic_body(
        &anthropic_model("claude-opus-5-5", opus_caps()),
        &CompletionRequest::prompt("s", "u"),
    )
    .unwrap();
    assert_eq!(five["thinking"], json!({"type":"adaptive"}));
    assert!(five.get("output_config").is_none());
    let four = anthropic_body(
        &anthropic_model("claude-opus-4-8", ModelCaps::default()),
        &CompletionRequest::prompt("s", "u"),
    )
    .unwrap();
    assert!(four.get("thinking").is_none() && four.get("output_config").is_none());
    let four_low = anthropic_body(
        &anthropic_model("claude-opus-4-8", ModelCaps::default()),
        &with_effort(Effort::Low),
    )
    .unwrap();
    assert_eq!(
        (
            four_low["thinking"]["type"].as_str(),
            four_low["output_config"]["effort"].as_str()
        ),
        (Some("adaptive"), Some("low"))
    );
}

#[test]
fn reasoning_summaries_ask_for_summarized_display() {
    let body = anthropic_body(
        &anthropic_model("claude-opus-5-5", opus_caps()),
        &CompletionRequest {
            reasoning_summary: Some(true),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert_eq!(body["thinking"]["display"], "summarized");
}

#[test]
fn none_effort_disables_thinking_only_on_toggle_models() {
    let haiku = anthropic_body(
        &anthropic_model("claude-haiku-5-5", haiku_caps_with_toggle()),
        &with_effort(Effort::Off),
    )
    .unwrap();
    assert_eq!(haiku["thinking"], json!({"type":"disabled"}));
    assert!(haiku.get("output_config").is_none());
    let opus = anthropic_body(
        &anthropic_model("claude-opus-5-5", opus_caps()),
        &with_effort(Effort::Off),
    )
    .unwrap();
    assert_eq!(opus["output_config"]["effort"], "low");
}

#[test]
fn replayed_thinking_turns_on_the_drop_block_safety_net() {
    let mut req = CompletionRequest::prompt("s", "u");
    req.messages.push(Message {
        role: Role::Assistant,
        content: vec![
            ContentPart::Thinking {
                thinking: String::new(),
                signature: "sig".into(),
            },
            ContentPart::ToolUse {
                id: "t".into(),
                name: "read_file".into(),
                arguments: "{}".into(),
                thought_signature: None,
            },
        ],
    });
    req.messages.push(Message {
        role: Role::User,
        content: vec![ContentPart::tool_result("t", "read_file", "ok")],
    });
    let body = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    assert_eq!(
        body["thinking"]["block_binding"]["prefix_mismatch_behavior"],
        "drop_block"
    );
    assert_eq!(
        anthropic_beta_header(&body),
        Some("thinking-binding-controls-2026-08-01")
    );
    assert_eq!(
        anthropic_beta_header(
            &anthropic_body(
                &anthropic_model("claude-opus-5-5", opus_caps()),
                &CompletionRequest::prompt("s", "u")
            )
            .unwrap()
        ),
        None
    );
}

#[test]
fn anthropic_requests_cache_the_tool_list_and_the_conversation() {
    let req = CompletionRequest {
        tools: vec![tool("zeta"), tool("alpha")],
        ..CompletionRequest::prompt("s", "u")
    };
    let body = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    assert_eq!(body["cache_control"], json!({"type":"ephemeral"}));
    assert_eq!(
        (
            body["tools"][0]["name"].as_str(),
            body["tools"][1]["name"].as_str()
        ),
        (Some("alpha"), Some("zeta"))
    );
    assert_eq!(
        body["tools"][1]["cache_control"],
        json!({"type":"ephemeral"})
    );
    assert!(body["tools"][0].get("cache_control").is_none());
}

#[test]
fn a_system_suffix_becomes_a_second_uncached_block() {
    let req = CompletionRequest {
        system_suffix: Some("ctx".into()),
        ..CompletionRequest::prompt("stable", "u")
    };
    let body = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    assert_eq!(
        body["system"],
        json!([{"type":"text","text":"stable","cache_control":{"type":"ephemeral"}},{"type":"text","text":"ctx"}])
    );
    assert_eq!(
        openai_body(&openai(), &req).unwrap()["messages"][0]["content"],
        "stable\n\nctx"
    );
    assert_eq!(
        openai_responses_body(&openai_responses(), &req).unwrap()["instructions"],
        "stable\n\nctx"
    );
    assert_eq!(
        google_body(&google(), &req).unwrap()["systemInstruction"]["parts"],
        json!([{"text":"stable"},{"text":"ctx"}])
    );
}

#[test]
fn anthropic_default_max_tokens_follow_the_output_limit() {
    for (limit, want) in [
        (Some(128_000), 64_000),
        (Some(4_096), 4_096),
        (None, 16_000),
    ] {
        let caps = ModelCaps {
            output_limit: limit,
            ..ModelCaps::default()
        };
        assert_eq!(
            anthropic_body(
                &anthropic_model("claude-x", caps),
                &CompletionRequest::prompt("s", "u")
            )
            .unwrap()["max_tokens"],
            want
        );
    }
    assert_eq!(
        anthropic_body(
            &anthropic_model("claude-x", ModelCaps::default()),
            &CompletionRequest {
                max_tokens: Some(64),
                ..CompletionRequest::prompt("s", "u")
            }
        )
        .unwrap()["max_tokens"],
        64
    );
}

#[test]
fn older_claude_models_get_a_default_that_leaves_room_for_the_input() {
    let caps = || ModelCaps {
        output_limit: Some(64_000),
        context_window: Some(200_000),
        ..ModelCaps::default()
    };
    let default_for = |model: &str| {
        anthropic_body(
            &anthropic_model(model, caps()),
            &CompletionRequest::prompt("s", "u"),
        )
        .unwrap()["max_tokens"]
            .clone()
    };
    for model in [
        "claude-sonnet-4-20250514",
        "claude-opus-4-1",
        "claude-3-7-sonnet-latest",
    ] {
        assert_eq!(default_for(model), 16_000, "{model}");
    }
    for model in ["claude-sonnet-4-5", "claude-opus-5-5", "claude-haiku-4-5"] {
        assert_eq!(default_for(model), 64_000, "{model}");
    }
}

#[test]
fn blocking_completions_cap_the_default_at_16k() {
    let r = anthropic_model(
        "claude-opus-5-5",
        ModelCaps {
            output_limit: Some(128_000),
            ..ModelCaps::default()
        },
    );
    assert_eq!(
        with_blocking_ceiling(&r, &CompletionRequest::prompt("s", "u")).max_tokens,
        Some(16_000)
    );
    assert_eq!(
        with_blocking_ceiling(&openai_responses(), &CompletionRequest::prompt("s", "u")).max_tokens,
        None
    );
}

#[test]
fn responses_reasoning_carries_effort_and_summaries_only_on_request() {
    let sol = responses_model(
        "gpt-6.1-sol",
        reasoning_caps(&[
            Effort::Low,
            Effort::Medium,
            Effort::High,
            Effort::Xhigh,
            Effort::Max,
        ]),
    );
    let body = openai_responses_body(&sol, &with_effort(Effort::Xhigh)).unwrap();
    assert_eq!(body["reasoning"], json!({"effort":"xhigh"}));
    let summaries = openai_responses_body(
        &sol,
        &CompletionRequest {
            reasoning_summary: Some(true),
            ..with_effort(Effort::Xhigh)
        },
    )
    .unwrap();
    assert_eq!(
        summaries["reasoning"],
        json!({"effort":"xhigh","summary":"auto"})
    );
    let off = openai_responses_body(
        &sol,
        &CompletionRequest {
            reasoning_summary: Some(false),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert!(off.get("reasoning").is_none());
    let gpt4o = responses_model(
        "gpt-4o",
        ModelCaps {
            reasoning: ReasoningCaps {
                flag: Some(false),
                ..Default::default()
            },
            ..ModelCaps::default()
        },
    );
    assert!(openai_responses_body(&gpt4o, &with_effort(Effort::High))
        .unwrap()
        .get("reasoning")
        .is_none());
}

#[test]
fn responses_minimal_effort_is_raised_when_web_search_is_on() {
    let gpt5 = responses_model(
        "gpt-5",
        reasoning_caps(&[Effort::Minimal, Effort::Low, Effort::Medium, Effort::High]),
    );
    let body = openai_responses_body(
        &gpt5,
        &CompletionRequest {
            effort: Some(Effort::Minimal),
            web: Some(WebTools {
                search: true,
                fetch: false,
            }),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert_eq!(body["reasoning"]["effort"], "low");
}

#[test]
fn chat_providers_get_their_own_reasoning_field() {
    assert_eq!(
        openai_body(
            &chat(
                "xai",
                "grok-4.7",
                reasoning_caps(&[Effort::Low, Effort::Medium, Effort::High, Effort::Xhigh])
            ),
            &with_effort(Effort::High)
        )
        .unwrap()["reasoning_effort"],
        "high"
    );
    assert_eq!(
        openai_body(
            &chat("groq", "openai/gpt-oss-120b", ModelCaps::default()),
            &with_effort(Effort::Xhigh)
        )
        .unwrap()["reasoning_effort"],
        "high"
    );
    assert_eq!(
        openai_body(
            &chat(
                "openrouter",
                "anthropic/claude-opus-5.5",
                reasoning_caps(&[Effort::Low, Effort::High])
            ),
            &with_effort(Effort::High)
        )
        .unwrap()["reasoning"],
        json!({"effort":"high"})
    );
    assert_eq!(
        openai_body(
            &chat("ollama", "gpt-oss:20b", ModelCaps::default()),
            &with_effort(Effort::Low)
        )
        .unwrap()["reasoning_effort"],
        "low"
    );
    let deepseek = openai_body(
        &chat("deepseek", "deepseek-flash", ModelCaps::default()),
        &with_effort(Effort::High),
    )
    .unwrap();
    assert_eq!(deepseek["reasoning_effort"], "high");
    assert!(deepseek.get("reasoning").is_none());
    assert!(openai_body(
        &chat("mistral", "mistral-medium-latest", ModelCaps::default()),
        &with_effort(Effort::High)
    )
    .unwrap()
    .get("reasoning_effort")
    .is_none());
}

#[test]
fn openrouter_without_summaries_excludes_reasoning() {
    let body = openai_body(
        &chat("openrouter", "x/y", ModelCaps::default()),
        &CompletionRequest {
            reasoning_summary: Some(false),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert_eq!(body["reasoning"], json!({"exclude": true}));
}

#[test]
fn groq_gets_a_completion_token_ceiling_from_metadata() {
    let body = openai_body(
        &chat(
            "groq",
            "openai/gpt-oss-120b",
            ModelCaps {
                output_limit: Some(65_536),
                ..ModelCaps::default()
            },
        ),
        &CompletionRequest::prompt("s", "u"),
    )
    .unwrap();
    assert_eq!(body["max_completion_tokens"], 64_000);
    assert!(body.get("max_tokens").is_none());
}

#[test]
fn gemini_effort_sets_a_level_or_a_budget_never_both() {
    let level = google_body(
        &gemini(
            "gemini-3.8-flash",
            reasoning_caps(&[Effort::Low, Effort::Medium, Effort::High]),
        ),
        &with_effort(Effort::High),
    )
    .unwrap();
    assert_eq!(
        level["generationConfig"]["thinkingConfig"],
        json!({"includeThoughts": true, "thinkingLevel": "high"})
    );
    let auto4 = google_body(
        &gemini("gemini-4-argon", ModelCaps::default()),
        &CompletionRequest::prompt("s", "u"),
    )
    .unwrap();
    assert_eq!(
        auto4["generationConfig"]["thinkingConfig"]["thinkingLevel"],
        "medium"
    );
    let flash = flash_25_caps();
    for (effort, want) in [
        (Effort::Off, 0),
        (Effort::Low, 1_024),
        (Effort::Medium, 8_192),
        (Effort::High, 24_576),
    ] {
        let body = google_body(
            &gemini("gemini-2.5-flash", flash.clone()),
            &with_effort(effort),
        )
        .unwrap();
        let config = &body["generationConfig"]["thinkingConfig"];
        assert_eq!(config["thinkingBudget"], want);
        assert!(config.get("thinkingLevel").is_none());
    }
    assert_eq!(
        google_body(
            &gemini("gemini-2.5-pro", pro_25_caps()),
            &with_effort(Effort::High)
        )
        .unwrap()["generationConfig"]["thinkingConfig"]["thinkingBudget"],
        32_768
    );
    assert_eq!(
        BudgetRange {
            min: Some(0),
            max: Some(1)
        }
        .max,
        Some(1)
    );
}

#[test]
fn gemini_without_summaries_hides_thoughts() {
    let body = google_body(
        &gemini("gemini-3.8-flash", ModelCaps::default()),
        &CompletionRequest {
            reasoning_summary: Some(false),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["includeThoughts"],
        false
    );
}

#[test]
fn gemini_output_ceiling_comes_from_metadata() {
    assert_eq!(
        google_body(
            &gemini(
                "gemini-3.8-flash",
                ModelCaps {
                    output_limit: Some(65_536),
                    ..ModelCaps::default()
                }
            ),
            &CompletionRequest::prompt("s", "u")
        )
        .unwrap()["generationConfig"]["maxOutputTokens"],
        64_000
    );
    assert!(google_body(
        &gemini("gemini-3.8-flash", ModelCaps::default()),
        &CompletionRequest::prompt("s", "u")
    )
    .unwrap()["generationConfig"]
        .get("maxOutputTokens")
        .is_none());
}

#[test]
fn tool_lists_are_sorted_by_name_on_every_wire() {
    let req = CompletionRequest {
        tools: vec![tool("zeta"), tool("alpha")],
        ..CompletionRequest::prompt("s", "u")
    };
    let chat_body = openai_body(&openai(), &req).unwrap();
    assert_eq!(chat_body["tools"][0]["function"]["name"], "alpha");
    let responses = openai_responses_body(&openai_responses(), &req).unwrap();
    assert_eq!(responses["tools"][0]["name"], "alpha");
    let google_body = google_body(&google(), &req).unwrap();
    assert_eq!(
        google_body["tools"][0]["functionDeclarations"][0]["name"],
        "alpha"
    );
}

fn user_with(parts: Vec<ContentPart>) -> CompletionRequest {
    CompletionRequest {
        messages: vec![Message {
            role: Role::User,
            content: parts,
        }],
        ..Default::default()
    }
}

fn doc_part() -> ContentPart {
    ContentPart::Document {
        mime: "application/pdf".into(),
        data: "JVBE".into(),
        name: "a.pdf".into(),
    }
}

fn tool_turn_with_images(images: Vec<String>) -> CompletionRequest {
    let mut req = tool_turn();
    if let Some(ContentPart::ToolResult {
        images: slot,
        output,
        ..
    }) = req.messages[2].content.first_mut()
    {
        *slot = images;
        *output = "result".into();
    }
    req
}

fn assistant_then_user(parts: Vec<ContentPart>) -> CompletionRequest {
    CompletionRequest {
        messages: vec![
            Message::user("find it"),
            Message {
                role: Role::Assistant,
                content: parts,
            },
            Message::user("thanks"),
        ],
        ..Default::default()
    }
}

#[test]
fn documents_take_each_providers_own_shape() {
    let req = user_with(vec![doc_part(), ContentPart::text("summarize")]);
    let a = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    assert_eq!(
        a["messages"][0]["content"][0],
        json!({"type":"document","source":{"type":"base64","media_type":"application/pdf","data":"JVBE"},"title":"a.pdf"})
    );
    assert_eq!(a["messages"][0]["content"][1]["type"], "text");
    assert_eq!(
        openai_responses_body(&openai_responses(), &req).unwrap()["input"][0]["content"][0],
        json!({"type":"input_file","filename":"a.pdf","file_data":"data:application/pdf;base64,JVBE"})
    );
    assert_eq!(
        google_body(&google(), &req).unwrap()["contents"][0]["parts"][0],
        json!({"inlineData":{"mimeType":"application/pdf","data":"JVBE"}})
    );
    let or = openai_body(&chat("openrouter", "x/y", ModelCaps::default()), &req).unwrap();
    assert_eq!(or["messages"][0]["content"][0]["type"], "file");
    assert_eq!(
        or["plugins"],
        json!([{"id":"file-parser","pdf":{"engine":"native"}}])
    );
}

#[test]
fn a_document_never_reaches_a_provider_without_file_input() {
    assert!(openai_body(
        &chat("groq", "openai/gpt-oss-120b", ModelCaps::default()),
        &user_with(vec![doc_part()])
    )
    .is_err());
}

#[test]
fn anthropic_nests_tool_images_inside_their_tool_result() {
    let req = tool_turn_with_images(vec!["data:image/png;base64,AA".into()]);
    let body = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    let content = &body["messages"][2]["content"];
    assert_eq!(content.as_array().unwrap().len(), 1);
    assert_eq!(
        content[0]["content"][0],
        json!({"type":"text","text":"result"})
    );
    assert_eq!(content[0]["content"][1]["type"], "image");
}

#[test]
fn other_wires_keep_tool_images_after_the_results() {
    let req = tool_turn_with_images(vec!["data:image/png;base64,AA".into()]);
    let chat_body = openai_body(&openai(), &req).unwrap();
    let messages = chat_body["messages"].as_array().unwrap();
    let tool_at = messages.iter().position(|m| m["role"] == "tool").unwrap();
    assert_eq!(messages[tool_at + 1]["role"], "user");
    assert_eq!(messages[tool_at + 1]["content"][0]["type"], "image_url");

    let responses = openai_responses_body(&openai_responses(), &req).unwrap();
    let input = responses["input"].as_array().unwrap();
    let output_at = input
        .iter()
        .position(|item| item["type"] == "function_call_output")
        .unwrap();
    assert_eq!(input[output_at + 1]["content"][0]["type"], "input_image");

    let google_body = google_body(&google(), &req).unwrap();
    let parts = google_body["contents"][2]["parts"].as_array().unwrap();
    assert!(parts[0].get("functionResponse").is_some());
    assert!(parts[1].get("inlineData").is_some());
}

#[test]
fn anthropic_replays_thinking_and_provider_blocks_verbatim_in_order() {
    let server = json!({"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{"query":"q"}});
    let result = json!({"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[{"type":"web_search_result","url":"https://e.org","title":"E","encrypted_content":"x"}]});
    let cited = json!({"type":"text","text":"born 1916","citations":[{"type":"web_search_result_location","url":"https://e.org","title":"E","encrypted_index":"i","cited_text":"1916"}]});
    let req = assistant_then_user(vec![
        ContentPart::Thinking {
            thinking: String::new(),
            signature: "s1".into(),
        },
        ContentPart::text("Searching."),
        ContentPart::ProviderBlock {
            wire: ProviderWire::Anthropic,
            block: server.clone(),
        },
        ContentPart::ProviderBlock {
            wire: ProviderWire::Anthropic,
            block: result.clone(),
        },
        ContentPart::Thinking {
            thinking: "more".into(),
            signature: "s2".into(),
        },
        ContentPart::ProviderBlock {
            wire: ProviderWire::Anthropic,
            block: cited.clone(),
        },
    ]);
    assert_eq!(
        anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap()["messages"]
            [1]["content"],
        json!([
            {"type":"thinking","thinking":"","signature":"s1"},
            {"type":"text","text":"Searching."},
            server,
            result,
            {"type":"thinking","thinking":"more","signature":"s2"},
            cited
        ])
    );
}

#[test]
fn thinking_and_provider_blocks_never_reach_other_wires() {
    let req = assistant_then_user(vec![
        ContentPart::Thinking {
            thinking: "secret".into(),
            signature: "sig-xyz".into(),
        },
        ContentPart::text("Answer."),
        ContentPart::ProviderBlock {
            wire: ProviderWire::Anthropic,
            block: json!({"type":"server_tool_use","id":"srvtoolu_1"}),
        },
    ]);
    for body in [
        openai_body(&openai(), &req).unwrap(),
        openai_responses_body(&openai_responses(), &req).unwrap(),
        google_body(&google(), &req).unwrap(),
    ] {
        let text = body.to_string();
        assert!(!text.contains("sig-xyz"), "{text}");
        assert!(!text.contains("srvtoolu_1"), "{text}");
        assert!(!text.contains("\"type\":\"thinking\""), "{text}");
    }
}

#[test]
fn anthropic_skips_empty_and_whitespace_only_assistant_text() {
    let req = assistant_then_user(vec![
        ContentPart::text(""),
        ContentPart::text("  "),
        ContentPart::ToolUse {
            id: "t".into(),
            name: "read_file".into(),
            arguments: "{}".into(),
            thought_signature: None,
        },
    ]);
    let body = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap();
    let content = body["messages"][1]["content"].as_array().unwrap();
    assert_eq!(content.len(), 1);
    assert_eq!(content[0]["type"], "tool_use");
}

#[test]
fn unsupported_image_types_are_refused_before_sending() {
    let req = user_with(vec![ContentPart::Image {
        image: "data:image/svg+xml;base64,AA".into(),
    }]);
    assert!(anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).is_err());
    assert!(openai_body(&openai(), &req).is_err());
    assert!(google_body(&google(), &req).is_err());
}

#[test]
fn unresolved_attachments_never_leave() {
    let req = user_with(vec![ContentPart::Attachment {
        sha256: "a".repeat(64),
        name: "x.png".into(),
        mime: "image/png".into(),
    }]);
    for result in [
        anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req),
        openai_body(&openai(), &req),
        openai_responses_body(&openai_responses(), &req),
        google_body(&google(), &req),
    ] {
        assert!(result.unwrap_err().to_string().contains("resolved"));
    }
}

#[test]
fn anthropic_web_versions_follow_the_model_family() {
    assert_eq!(
        anthropic_web_versions("claude-opus-5-5").unwrap().search,
        "web_search_20260209"
    );
    assert_eq!(
        anthropic_web_versions("claude-haiku-5-5").unwrap().fetch,
        "web_fetch_20250910"
    );
    assert!(anthropic_web_versions("claude-3-haiku-20240307").is_none());
}

#[test]
fn hosted_web_tools_replace_local_tools_of_the_same_name() {
    let req = CompletionRequest {
        tools: vec![tool("web_search"), tool("read_file")],
        web: Some(WebTools {
            search: true,
            fetch: true,
        }),
        ..CompletionRequest::prompt("s", "u")
    };
    let tools = anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap()
        ["tools"]
        .clone();
    let names: Vec<(String, Option<String>)> = tools
        .as_array()
        .unwrap()
        .iter()
        .map(|tool| {
            (
                tool["name"].as_str().unwrap().to_string(),
                tool.get("type")
                    .and_then(|value| value.as_str())
                    .map(String::from),
            )
        })
        .collect();
    assert_eq!(
        names,
        vec![
            ("read_file".to_string(), None),
            (
                "web_search".to_string(),
                Some("web_search_20260209".to_string())
            ),
            (
                "web_fetch".to_string(),
                Some("web_fetch_20260209".to_string())
            )
        ]
    );
}

#[test]
fn responses_web_search_adds_the_hosted_tool_and_sources() {
    let body = openai_responses_body(
        &responses_model("gpt-6.1-sol", ModelCaps::default()),
        &CompletionRequest {
            web: Some(WebTools {
                search: true,
                fetch: true,
            }),
            ..CompletionRequest::prompt("s", "u")
        },
    )
    .unwrap();
    assert!(body["tools"]
        .as_array()
        .unwrap()
        .contains(&json!({"type":"web_search"})));
    assert_eq!(
        body["include"],
        json!([
            "reasoning.encrypted_content",
            "web_search_call.action.sources"
        ])
    );
}

#[test]
fn web_off_adds_no_hosted_tools() {
    for web in [
        None,
        Some(WebTools {
            search: false,
            fetch: false,
        }),
    ] {
        let req = CompletionRequest {
            web,
            ..CompletionRequest::prompt("s", "u")
        };
        assert!(
            anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req)
                .unwrap()
                .get("tools")
                .is_none()
        );
        assert!(
            openai_responses_body(&responses_model("gpt-6.1-sol", ModelCaps::default()), &req)
                .unwrap()
                .get("tools")
                .is_none()
        );
    }
}

#[test]
fn the_container_is_sent_back_when_known() {
    let req = CompletionRequest {
        anthropic_container: Some("cntr_1".into()),
        ..CompletionRequest::prompt("s", "u")
    };
    assert_eq!(
        anthropic_body(&anthropic_model("claude-opus-5-5", opus_caps()), &req).unwrap()
            ["container"],
        "cntr_1"
    );
}
