use super::*;
use crate::acp::one_shot::{claude_options, image_prompt, low_effort, read_only_mode, Reply};
use crate::acp::OneShot;
use oleafly_acp::controls::SessionControls;
use oleafly_agent::{CompletionRequest, CompletionResponse, ContentPart, Message, Role};

const PIXEL: &str = "data:image/png;base64,iVBORw0KGgo=";
/// The fixture's Claude-shaped options, which include a read-only mode.
const MODES: &str = "--claude-options";

fn request(text: &str, image: bool) -> CompletionRequest {
    let mut content = Vec::new();
    if image {
        content.push(ContentPart::Image {
            image: PIXEL.into(),
        });
    }
    content.push(ContentPart::Text { text: text.into() });
    CompletionRequest {
        system: Some("Return only LaTeX.".into()),
        messages: vec![Message {
            role: Role::User,
            content,
        }],
        ..CompletionRequest::default()
    }
}

async fn ask(
    extra: &[&str],
    model: &str,
    request: CompletionRequest,
) -> (tempfile::TempDir, Result<CompletionResponse, String>) {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    let mut args = vec!["--record-requests"];
    args.extend_from_slice(extra);
    runtime
        .register(&serde_json::to_string(&check_definition(temp.path(), &args)).unwrap())
        .unwrap();
    let shot = OneShot::new("fixture-agent", model, &request).unwrap();
    let answer = tokio::time::timeout(Duration::from_secs(30), runtime.one_shot(shot))
        .await
        .expect("the turn ends");
    (temp, answer)
}

async fn wait_until(check: impl Fn() -> bool) {
    let deadline = std::time::Instant::now() + CHILD_PATIENCE;
    while !check() {
        assert!(std::time::Instant::now() < deadline, "timed out");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn requests(temp: &tempfile::TempDir, method: &str) -> Vec<Value> {
    std::fs::read_to_string(temp.path().join("requests.jsonl"))
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .filter(|entry| entry["method"] == method)
        .map(|entry| entry["params"].clone())
        .collect()
}

#[tokio::test]
async fn an_image_reaches_the_agent_first_in_an_empty_folder_with_no_servers() {
    let (temp, answer) = ask(&[MODES], "default", request("warned", true)).await;
    let answer = answer.unwrap();
    assert_eq!(answer.text, "E = mc^2");
    assert_eq!(answer.provider_id, "acp:fixture-agent");
    assert_eq!(answer.stop_reason.as_deref(), Some("end_turn"));

    let opened = requests(&temp, "session/new");
    assert_eq!(opened[0]["mcpServers"], json!([]));
    assert!(!opened[0].as_object().unwrap().contains_key("systemPrompt"));
    let cwd = Path::new(opened[0]["cwd"].as_str().unwrap());
    assert_eq!(
        cwd.parent().and_then(Path::file_name),
        Some(std::ffi::OsStr::new("probe"))
    );

    let prompt = requests(&temp, "session/prompt");
    let blocks = prompt[0]["prompt"].as_array().unwrap();
    assert_eq!(blocks[0]["type"], "image");
    assert_eq!(blocks[0]["mimeType"], "image/png");
    assert_eq!(blocks[1]["text"], "Return only LaTeX.\n\nwarned");
}

#[tokio::test]
async fn a_system_prompt_goes_to_an_agent_that_takes_one() {
    let (temp, answer) = ask(
        &[MODES, "--system-prompt"],
        "default",
        request("warned", false),
    )
    .await;
    answer.unwrap();
    assert_eq!(
        requests(&temp, "session/new")[0]["systemPrompt"],
        json!({"mode": "override", "content": [{"type": "text", "text": "Return only LaTeX."}]})
    );
    assert_eq!(
        requests(&temp, "session/prompt")[0]["prompt"],
        json!([{"type": "text", "text": "warned"}])
    );
}

#[tokio::test]
async fn nothing_is_left_in_the_session_list_or_the_probe_folder() {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&check_definition(temp.path(), &[MODES])).unwrap())
        .unwrap();
    let shot = OneShot::new("fixture-agent", "default", &request("warned", false)).unwrap();
    runtime.one_shot(shot).await.unwrap();
    assert!(runtime.all_sessions(None, 10).unwrap().is_empty());
    let left = std::fs::read_dir(temp.path().join("acp").join("probe"))
        .map(|entries| entries.count())
        .unwrap_or(0);
    assert_eq!(left, 0);
}

#[tokio::test]
async fn a_chosen_model_is_set_and_a_gone_one_is_refused() {
    let (temp, answer) = ask(&[MODES], "sonnet", request("warned", false)).await;
    answer.unwrap();
    let changes = requests(&temp, "session/set_config_option");
    assert!(changes
        .iter()
        .any(|change| change["configId"] == "model" && change["value"] == "sonnet"));

    let (_temp, answer) = ask(&[MODES], "retired", request("warned", false)).await;
    assert_eq!(answer.unwrap_err(), "[agent_model] retired");

    let (temp, answer) = ask(&[MODES], "default", request("warned", false)).await;
    answer.unwrap();
    assert!(!requests(&temp, "session/set_config_option")
        .iter()
        .any(|change| change["configId"] == "model"));
}

#[tokio::test]
async fn an_agent_with_modes_reads_in_its_read_only_one_at_low_effort() {
    let (temp, answer) = ask(&[MODES], "default", request("warned", false)).await;
    answer.unwrap();
    let changes = requests(&temp, "session/set_config_option");
    assert!(changes
        .iter()
        .any(|change| change["configId"] == "mode" && change["value"] == "plan"));
    assert!(changes
        .iter()
        .any(|change| change["configId"] == "effort" && change["value"] == "low"));

    let (temp, answer) = ask(&["--codex-options"], "default", request("warned", false)).await;
    answer.unwrap();
    assert!(requests(&temp, "session/set_config_option")
        .iter()
        .any(|change| change["configId"] == "mode" && change["value"] == "read-only"));
}

#[tokio::test]
async fn an_agent_that_cannot_be_held_to_reading_never_sees_the_prompt() {
    let (temp, answer) = ask(&[], "default", request("warned", true)).await;
    assert!(
        answer
            .as_ref()
            .unwrap_err()
            .starts_with("[agent_read_only]"),
        "{answer:?}"
    );
    assert!(requests(&temp, "session/prompt").is_empty());

    let (temp, answer) = ask(
        &[MODES, "--refuse-mode"],
        "default",
        request("warned", true),
    )
    .await;
    assert!(
        answer
            .as_ref()
            .unwrap_err()
            .starts_with("[agent_read_only]"),
        "{answer:?}"
    );
    assert!(requests(&temp, "session/prompt").is_empty());
}

#[tokio::test]
async fn a_tool_call_stops_the_turn() {
    let (_temp, answer) = ask(&[MODES], "default", request("use-a-tool", false)).await;
    assert!(
        answer.as_ref().unwrap_err().starts_with("[agent_tool]"),
        "{answer:?}"
    );
}

#[tokio::test]
async fn a_turn_that_ends_right_after_a_tool_call_is_not_a_transcription() {
    let (_temp, answer) = ask(&[MODES], "default", request("tool-then-done", false)).await;
    assert!(
        answer.as_ref().unwrap_err().starts_with("[agent_tool]"),
        "{answer:?}"
    );
}

#[tokio::test]
async fn cancelling_stops_the_agent_and_removes_its_folder() {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&check_definition(temp.path(), &[MODES])).unwrap())
        .unwrap();
    let shot = OneShot::new("fixture-agent", "default", &request("never-answers", false)).unwrap();
    let probes = temp.path().join("acp").join("probe");
    let count = || std::fs::read_dir(&probes).map_or(0, |entries| entries.count());
    let run = runtime.one_shot(shot);
    tokio::select! {
        answer = run => panic!("the turn ended: {answer:?}"),
        () = async {
            wait_until(|| count() == 1).await;
            tokio::time::sleep(Duration::from_millis(300)).await;
        } => {}
    }
    wait_until(|| count() == 0).await;
}

#[tokio::test]
async fn a_failed_turn_never_comes_back_as_a_transcription() {
    let (_temp, answer) = ask(&[MODES], "default", request("turn-fails", false)).await;
    assert_eq!(
        answer.unwrap_err(),
        "[agent] You have hit your usage limit."
    );
}

#[tokio::test]
async fn sign_in_failures_are_tagged_at_the_session_and_at_the_prompt() {
    let (_temp, answer) = ask(
        &[MODES, "--require-login"],
        "default",
        request("warned", false),
    )
    .await;
    assert!(
        answer.as_ref().unwrap_err().starts_with("[auth]"),
        "{answer:?}"
    );

    let (_temp, answer) = ask(&[MODES], "default", request("signed-out", false)).await;
    assert!(
        answer.as_ref().unwrap_err().starts_with("[auth]"),
        "{answer:?}"
    );
}

#[tokio::test]
async fn an_agent_that_cannot_read_images_says_so_before_any_session() {
    let (temp, answer) = ask(&[MODES, "--no-images"], "default", request("warned", true)).await;
    assert!(
        answer.as_ref().unwrap_err().starts_with("[agent_images]"),
        "{answer:?}"
    );
    assert!(requests(&temp, "session/new").is_empty());
}

#[test]
fn a_request_needs_a_user_message_of_text_and_data_url_images() {
    let shot = OneShot::new("agent", "default", &request("hello", true));
    assert!(shot.is_ok());

    let mut bad = request("hello", false);
    bad.messages[0].content.push(ContentPart::Image {
        image: "https://example.org/a.png".into(),
    });
    assert!(OneShot::new("agent", "default", &bad)
        .err()
        .unwrap()
        .starts_with("[agent]"));

    let mut assistant = request("hello", false);
    assistant.messages[0].role = Role::Assistant;
    assert!(OneShot::new("agent", "default", &assistant).is_err());

    let image = image_prompt(PIXEL).unwrap();
    assert_eq!(image.mime_type, "image/png");
    assert_eq!(image.data, "iVBORw0KGgo=");
    assert!(image_prompt("data:image/png,plain").is_none());
}

#[test]
fn only_text_ahead_of_the_first_message_id_is_dropped() {
    let mut reply = Reply::default();
    assert!(!reply.push(&json!({}), "Warning: skills. "));
    assert!(reply.push(&json!({"messageId": "m1"}), "E = "));
    assert!(reply.push(&json!({"messageId": "m1"}), "mc^2"));
    assert!(reply.streamed());
    assert_eq!(reply.text(), "E = mc^2");

    let mut plain = Reply::default();
    assert!(!plain.push(&json!({}), "Plain reply"));
    assert!(!plain.streamed());
    assert_eq!(plain.text(), "Plain reply");

    let mut mixed = Reply::default();
    mixed.push(&json!({"messageId": "m1"}), "Reading it. ");
    assert!(mixed.push(&json!({}), "E = mc^2"));
    assert_eq!(mixed.text(), "Reading it. E = mc^2");
}

async fn stream(
    extra: &[&str],
    request: CompletionRequest,
) -> (Vec<String>, Result<CompletionResponse, String>) {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&check_definition(temp.path(), extra)).unwrap())
        .unwrap();
    let pieces = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink: crate::acp::TextSink = {
        let pieces = pieces.clone();
        Arc::new(move |text: &str| pieces.lock().unwrap().push(text.to_owned()))
    };
    let shot = OneShot::new("fixture-agent", "default", &request)
        .unwrap()
        .streaming(sink);
    let answer = runtime.one_shot(shot).await;
    let pieces = pieces.lock().unwrap().clone();
    (pieces, answer)
}

#[tokio::test]
async fn a_streamed_reply_shows_its_text_and_never_the_warning_ahead_of_it() {
    let (pieces, answer) = stream(&[MODES], request("warned", false)).await;
    assert_eq!(answer.unwrap().text, "E = mc^2");
    assert_eq!(pieces, ["E = mc^2"]);
}

#[tokio::test]
async fn a_reply_with_no_message_ids_arrives_whole_at_the_end() {
    let (pieces, answer) = stream(&[MODES], request("turn-fails", false)).await;
    assert!(answer.is_err());
    assert!(pieces.is_empty(), "{pieces:?}");
}

#[test]
fn a_streamed_turn_may_run_longer_unless_the_caller_set_a_limit() {
    let plain = OneShot::new("agent", "default", &request("hi", false)).unwrap();
    let sink: crate::acp::TextSink = Arc::new(|_: &str| {});
    let streamed = OneShot::new("agent", "default", &request("hi", false))
        .unwrap()
        .streaming(sink.clone());
    assert!(streamed.total_limit() > plain.total_limit());
    let mut timed = request("hi", false);
    timed.timeout_ms = Some(5_000);
    let kept = OneShot::new("agent", "default", &timed)
        .unwrap()
        .streaming(sink);
    assert_eq!(kept.total_limit(), Duration::from_secs(5));
}

#[tokio::test]
async fn text_too_long_for_one_agent_message_is_its_own_failure() {
    let long = "x".repeat(300 * 1024);
    let (_temp, answer) = ask(&[MODES], "default", request(&long, false)).await;
    assert!(
        answer
            .as_ref()
            .unwrap_err()
            .starts_with("[agent_too_large]"),
        "{answer:?}"
    );
}

#[test]
fn claude_reads_with_no_tools_and_no_saved_conversation() {
    let options = claude_options(false);
    assert_eq!(options["tools"], json!([]));
    assert_eq!(options["title"], "Oleafly Tools");
    assert_eq!(options["persistSession"], false);
    assert_eq!(options["maxTurns"], 1);
    assert_eq!(options["settingSources"], json!([]));
    // A login in settings.json keeps them, and still no user MCP server or hook.
    let kept = claude_options(true);
    assert_eq!(kept["settingSources"], json!(["user"]));
    assert_eq!(kept["strictMcpConfig"], true);
    assert_eq!(kept["settings"], json!({"disableAllHooks": true}));
    assert_eq!(kept["tools"], json!([]));
}

#[test]
fn the_read_only_mode_and_lowest_effort_come_from_what_the_agent_offers() {
    let mut controls = SessionControls::default();
    controls.merge(&json!({
        "modes": {"currentModeId": "agent", "availableModes": [
            {"id": "read-only", "name": "Read-only"}, {"id": "plan", "name": "Plan"}]},
        "configOptions": [{"id": "reasoning", "name": "Effort", "category": "thought_level",
            "type": "select", "currentValue": "high", "options": [
                {"value": "low", "name": "Low"}, {"value": "high", "name": "High"}]}],
    }));
    assert_eq!(read_only_mode(&controls), Some("read-only"));
    assert_eq!(low_effort(&controls), Some(("reasoning", "low")));

    let mut bare = SessionControls::default();
    bare.merge(
        &json!({"modes": {"currentModeId": "yolo", "availableModes": [
        {"id": "yolo", "name": "YOLO"}]}}),
    );
    assert_eq!(read_only_mode(&bare), None);
    assert_eq!(low_effort(&bare), None);
}
