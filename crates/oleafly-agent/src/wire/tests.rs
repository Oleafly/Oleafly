use super::*;
use crate::complete::CompletionRequest;
use crate::message::ContentPart;
use crate::provider::{ANTHROPIC_BASE, GOOGLE_BASE, OPENAI_BASE};

fn resolved(wire: Wire) -> Resolved {
    Resolved {
        provider_id: "test".into(),
        model_id: "m-1".into(),
        credential: "sk-test".into(),
        auth: Some("sk-test".into()),
        wire,
    }
}
fn openai() -> Resolved {
    resolved(Wire::OpenAiChat {
        base_url: OPENAI_BASE.into(),
        reasoning_content: false,
    })
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
    assert!(google_body(&req)
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

    let gg = google_body(&req).unwrap();
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
    assert!(google_body(&req).is_err());
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
                    },
                ],
            },
            Message {
                role: Role::User,
                content: vec![ContentPart::ToolResult {
                    id: "call_1".into(),
                    name: "read_file".into(),
                    output: "\\documentclass{article}".into(),
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
    let body = google_body(&tool_turn()).unwrap();
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
        google_body(&request).unwrap()["tools"][0]["functionDeclarations"][0]["name"],
        "read_file"
    );
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
    assert!(google_body(&request).unwrap().get("tools").is_none());
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
fn anthropic_always_declares_a_token_ceiling() {
    let req = CompletionRequest::prompt("s", "u");
    assert_eq!(
        anthropic_body(&openai(), &req).unwrap()["max_tokens"],
        DEFAULT_MAX_TOKENS
    );

    let capped = CompletionRequest {
        max_tokens: Some(64),
        ..CompletionRequest::prompt("s", "u")
    };
    assert_eq!(
        anthropic_body(&openai(), &capped).unwrap()["max_tokens"],
        64
    );
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
    let body = google_body(&req).unwrap();
    assert_eq!(body["contents"][0]["role"], "user");
    assert_eq!(body["contents"][1]["role"], "model");
}

#[test]
fn generation_config_is_omitted_when_nothing_was_asked_for() {
    let req = CompletionRequest::prompt("s", "u");
    assert!(google_body(&req).unwrap().get("generationConfig").is_none());
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
            "gemini-2.5-pro"
        ),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    );
}
