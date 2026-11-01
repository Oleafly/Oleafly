use std::sync::{Arc, Mutex};

use oleafly_agent::{
    build_client, run_agent, AgentEvent, CompletionRequest, Effort, Message, ModelCaps, Resolved,
    RunConfig, ToolOutput, ToolRunner, ToolSchema, WebTools, Wire,
};

const KEY_VAR: &str = "OLEAFLY_LIVE_ANTHROPIC_KEY";
const MODEL: &str = "claude-opus-5-5";

fn live_key() -> Option<String> {
    let key = std::env::var(KEY_VAR).ok()?.trim().to_string();
    if key.is_empty() {
        eprintln!("{KEY_VAR} is not set; skipping");
        return None;
    }
    Some(key)
}

fn resolved(key: String) -> Resolved {
    Resolved {
        provider_id: "anthropic".into(),
        model_id: MODEL.into(),
        credential: key.clone(),
        auth: Some(key),
        wire: Wire::Anthropic {
            base_url: "https://api.anthropic.com/v1".into(),
        },
        caps: ModelCaps::default(),
    }
}

fn pong_runner() -> ToolRunner {
    Arc::new(|_| Box::pin(async { ToolOutput::text("pong") }))
}

#[tokio::test]
#[ignore = "needs OLEAFLY_LIVE_ANTHROPIC_KEY"]
async fn a_tool_step_replays_thinking_and_the_run_finishes() {
    let Some(key) = live_key() else {
        return;
    };
    let request = CompletionRequest {
        system: Some("Call the ping tool once, then say what it answered.".into()),
        messages: vec![Message::user("Ping the tool, then tell me its answer.")],
        tools: vec![ToolSchema {
            name: "ping".into(),
            description: "Answers pong. Takes no arguments.".into(),
            input_schema: serde_json::json!({
                "type": "object",
                "properties": {},
                "additionalProperties": false
            }),
        }],
        effort: Some(Effort::Low),
        reasoning_summary: Some(true),
        ..CompletionRequest::default()
    };
    let client = build_client().unwrap();
    let outcome = run_agent(
        &client,
        &resolved(key),
        request,
        &RunConfig::default(),
        pong_runner(),
        |_| {},
    )
    .await
    .unwrap();
    eprintln!("stop: {:?}, steps: {}", outcome.stop_reason, outcome.steps);
    assert!(outcome.error.is_none(), "{:?}", outcome.error);
    assert!(outcome.steps >= 2);
}

#[tokio::test]
#[ignore = "needs OLEAFLY_LIVE_ANTHROPIC_KEY"]
async fn hosted_web_search_runs_on_the_provider() {
    let Some(key) = live_key() else {
        return;
    };
    let request = CompletionRequest {
        messages: vec![Message::user(
            "Search the web for the Oleafly GitHub repository and give its URL.",
        )],
        web: Some(WebTools {
            search: true,
            fetch: false,
        }),
        effort: Some(Effort::Low),
        ..CompletionRequest::default()
    };
    let client = build_client().unwrap();
    let names = Arc::new(Mutex::new(Vec::new()));
    let seen = names.clone();
    let outcome = run_agent(
        &client,
        &resolved(key),
        request,
        &RunConfig::default(),
        pong_runner(),
        move |event| {
            if let AgentEvent::ToolCallStart { name, .. } = event {
                seen.lock().unwrap().push(name);
            }
        },
    )
    .await
    .unwrap();
    eprintln!("answer: {}", outcome.text);
    assert!(outcome.error.is_none(), "{:?}", outcome.error);
    assert!(names
        .lock()
        .unwrap()
        .iter()
        .any(|name| name == "web_search"));
}
