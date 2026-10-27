use super::*;

fn run(kind: WireKind, raw: &str) -> (Vec<AgentEvent>, Translator) {
    let mut translator = Translator::new(kind);
    let mut decoder = SseDecoder::new();
    let mut events = Vec::new();
    for event in decoder.push(raw).unwrap() {
        events.extend(translator.translate(&event));
    }
    if let Some(event) = decoder.finish().unwrap() {
        events.extend(translator.translate(&event));
    }
    events.extend(translator.finish());
    (events, translator)
}

fn text_of(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::TextDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn reasoning_of(events: &[AgentEvent]) -> String {
    events
        .iter()
        .filter_map(|e| match e {
            AgentEvent::ReasoningDelta { text } => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

#[test]
fn utf8_code_points_split_across_network_chunks_are_lossless() {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"alpha α, flask 🧪\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let mut utf8 = IncrementalUtf8Decoder::default();
    let mut decoder = SseDecoder::new();
    let mut translator = Translator::new(WireKind::OpenAi);
    let mut events = Vec::new();

    for byte in raw.as_bytes().chunks(1) {
        let text = utf8.push(byte).unwrap();
        for event in decoder.push(&text).unwrap() {
            events.extend(translator.translate(&event));
        }
    }
    utf8.finish().unwrap();
    if let Some(event) = decoder.finish().unwrap() {
        events.extend(translator.translate(&event));
    }
    events.extend(translator.finish());

    assert_eq!(text_of(&events), "alpha α, flask 🧪");
}

#[test]
fn a_stream_ending_mid_code_point_is_a_decode_error() {
    let mut utf8 = IncrementalUtf8Decoder::default();
    assert_eq!(utf8.push(&[0xf0, 0x9f, 0xa7]).unwrap(), "");
    assert!(matches!(utf8.finish(), Err(AgentError::Decode(_))));
}

#[test]
fn stream_deadlines_honor_shorter_requests_and_cap_longer_ones() {
    let mut request = CompletionRequest::default();
    assert_eq!(stream_deadline(&request), MAX_STREAM_DURATION);

    request.timeout_ms = Some(1_500);
    assert_eq!(stream_deadline(&request), Duration::from_millis(1_500));

    request.timeout_ms = Some(u64::MAX);
    assert_eq!(stream_deadline(&request), MAX_STREAM_DURATION);
}

#[test]
fn aggregate_stream_budgets_fail_closed_without_retrying() {
    let mut raw = StreamBudget::with_limits(5, 5, 5);
    raw.add_raw(5).unwrap();
    let error = raw.add_raw(1).unwrap_err();
    assert!(matches!(error, AgentError::Decode(_)));
    assert!(!error.retryable());

    let mut output = StreamBudget::with_limits(5, 5, 5);
    output
        .observe(&AgentEvent::TextDelta { text: "123".into() })
        .unwrap();
    output
        .observe(&AgentEvent::ReasoningDelta { text: "45".into() })
        .unwrap();
    assert!(matches!(
        output.observe(&AgentEvent::TextDelta { text: "6".into() }),
        Err(AgentError::Decode(_))
    ));

    let mut arguments = StreamBudget::with_limits(5, 5, 5);
    arguments
        .observe(&AgentEvent::ToolCallArgsDelta {
            id: "call".into(),
            json: "12345".into(),
        })
        .unwrap();
    assert!(matches!(
        arguments.observe(&AgentEvent::ToolCallArgsDelta {
            id: "call".into(),
            json: "6".into(),
        }),
        Err(AgentError::Decode(_))
    ));
}

#[test]
fn openai_text_deltas_join_into_the_reply() {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let (events, _) = run(WireKind::OpenAi, raw);
    assert_eq!(text_of(&events), "Hello");
    assert!(matches!(events.last(), Some(AgentEvent::Done { .. })));
}

#[test]
fn openai_emits_done_exactly_once() {
    let raw = "data: {\"choices\":[{\"delta\":{\"content\":\"x\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let (events, _) = run(WireKind::OpenAi, raw);
    let dones = events
        .iter()
        .filter(|e| matches!(e, AgentEvent::Done { .. }))
        .count();
    assert_eq!(dones, 1);
    assert_eq!(
        events.last(),
        Some(&AgentEvent::Done {
            stop_reason: Some("stop".into())
        })
    );
}

#[test]
fn reasoning_content_is_kept_apart_from_the_answer() {
    let raw = concat!(
        "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"think\"}}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"answer\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let (events, _) = run(WireKind::OpenAi, raw);
    assert_eq!(reasoning_of(&events), "think");
    assert_eq!(text_of(&events), "answer");
}

#[test]
fn openai_usage_is_reported_when_the_provider_sends_it() {
    let raw = "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":4,\"prompt_tokens_details\":{\"cached_tokens\":3}}}\n\ndata: [DONE]\n\n";
    let (_, translator) = run(WireKind::OpenAi, raw);
    assert_eq!(
        translator.usage(),
        Usage {
            input: 11,
            output: 4,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(3),
            cache_write: Some(0),
            input_semantics: crate::complete::InputTokenSemantics::Inclusive,
            reasoning: None,
        }
    );
}

#[test]
fn responses_text_reasoning_and_usage_stream_through_the_common_events() {
    let raw = concat!(
        "event: response.reasoning_summary_text.delta\n",
        "data: {\"type\":\"response.reasoning_summary_text.delta\",\"delta\":\"think\"}\n\n",
        "event: response.output_text.delta\n",
        "data: {\"type\":\"response.output_text.delta\",\"delta\":\"answer\"}\n\n",
        "event: response.output_item.done\n",
        "data: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"reasoning\",\"id\":\"rs_1\",\"encrypted_content\":\"opaque\"}}\n\n",
        "event: response.completed\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":21,\"output_tokens\":8,\"input_tokens_details\":{\"cached_tokens\":5}}}}\n\n",
    );
    let (events, translator) = run(WireKind::OpenAiResponses, raw);
    assert_eq!(reasoning_of(&events), "think");
    assert_eq!(text_of(&events), "answer");
    assert_eq!(
        translator.usage(),
        Usage {
            input: 21,
            output: 8,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(5),
            cache_write: Some(0),
            input_semantics: crate::complete::InputTokenSemantics::Inclusive,
            reasoning: None,
        }
    );
    assert_eq!(translator.stop_reason().as_deref(), Some("completed"));
    assert_eq!(translator.response_items()[0]["type"], "reasoning");
    assert_eq!(
        translator.response_items()[0]["encrypted_content"],
        "opaque"
    );
}

#[test]
fn responses_function_argument_events_reassemble_into_a_tool_call() {
    let raw = concat!(
        "event: response.output_item.added\n",
        "data: {\"type\":\"response.output_item.added\",\"output_index\":2,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"read_file\",\"arguments\":\"\"}}\n\n",
        "event: response.function_call_arguments.delta\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":2,\"delta\":\"{\\\"pa\"}\n\n",
        "event: response.function_call_arguments.delta\n",
        "data: {\"type\":\"response.function_call_arguments.delta\",\"output_index\":2,\"delta\":\"th\\\":\\\"main.tex\\\"}\"}\n\n",
        "event: response.function_call_arguments.done\n",
        "data: {\"type\":\"response.function_call_arguments.done\",\"output_index\":2,\"arguments\":\"{\\\"path\\\":\\\"main.tex\\\"}\"}\n\n",
        "event: response.output_item.done\n",
        "data: {\"type\":\"response.output_item.done\",\"output_index\":2,\"item\":{\"type\":\"function_call\",\"id\":\"fc_1\",\"call_id\":\"call_1\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"main.tex\\\"}\"}}\n\n",
        "event: response.completed\n",
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":4,\"output_tokens\":3}}}\n\n",
    );
    let (events, translator) = run(WireKind::OpenAiResponses, raw);
    assert!(events
        .iter()
        .any(|event| matches!(event, AgentEvent::ToolCallStart { id, name } if id == "call_1" && name == "read_file")));
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call_1");
    assert_eq!(calls[0].name, "read_file");
    assert_eq!(calls[0].arguments, "{\"path\":\"main.tex\"}");
    assert_eq!(translator.response_items()[0]["call_id"], "call_1");
}

#[test]
fn responses_done_empty_and_malformed_events_are_handled_explicitly() {
    let (events, translator) = run(
        WireKind::OpenAiResponses,
        "data:   \n\ndata: not-json\n\ndata: [DONE]\n\n",
    );
    assert!(matches!(events.last(), Some(AgentEvent::Done { .. })));
    assert!(matches!(translator.error(), Some(AgentError::Decode(_))));
}

#[test]
fn responses_function_done_can_supply_the_unstreamed_argument_remainder() {
    let raw = concat!(
        "event: response.output_item.added\n",
        "data: {\"output_index\":1,\"item\":{\"type\":\"function_call\",\"id\":\"fc_2\",\"name\":\"read_file\"}}\n\n",
        "event: response.function_call_arguments.delta\n",
        "data: {\"output_index\":1,\"delta\":\"{\\\"path\\\"\"}\n\n",
        "event: response.function_call_arguments.done\n",
        "data: {\"output_index\":1,\"arguments\":\"{\\\"path\\\":\\\"main.tex\\\"}\"}\n\n",
    );
    let (_, translator) = run(WireKind::OpenAiResponses, raw);
    assert_eq!(
        translator.tool_calls()[0].arguments,
        "{\"path\":\"main.tex\"}"
    );
}

#[test]
fn responses_completion_falls_back_to_the_full_output_array() {
    let raw = concat!(
        "event: response.output_item.added\n",
        "data: {\"output_index\":0,\"item\":{\"type\":\"message\"}}\n\n",
        "event: response.completed\n",
        "data: {\"response\":{\"output\":[{\"type\":\"message\",\"id\":\"msg_1\"}]}}\n\n",
    );
    let (_, translator) = run(WireKind::OpenAiResponses, raw);
    assert_eq!(translator.response_items()[0]["id"], "msg_1");
    assert_eq!(translator.stop_reason().as_deref(), Some("completed"));
}

#[test]
fn responses_incomplete_preserves_the_provider_reason_or_uses_a_safe_default() {
    let (_, with_reason) = run(
        WireKind::OpenAiResponses,
        "event: response.incomplete\ndata: {\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}\n\n",
    );
    assert_eq!(
        with_reason.stop_reason().as_deref(),
        Some("max_output_tokens")
    );

    let (_, without_reason) = run(
        WireKind::OpenAiResponses,
        "event: response.incomplete\ndata: {\"response\":{}}\n\n",
    );
    assert_eq!(without_reason.stop_reason().as_deref(), Some("incomplete"));
}

#[test]
fn responses_refusals_reasoning_and_terminal_errors_use_common_events() {
    let raw = concat!(
        "event: response.refusal.delta\ndata: {\"delta\":\"cannot comply\"}\n\n",
        "event: response.reasoning_text.delta\ndata: {\"delta\":\"checked policy\"}\n\n",
        "event: response.failed\ndata: {\"response\":{\"error\":{\"message\":\"request failed\"}}}\n\n",
    );
    let (events, mut translator) = run(WireKind::OpenAiResponses, raw);
    assert_eq!(text_of(&events), "cannot comply");
    assert_eq!(reasoning_of(&events), "checked policy");
    assert!(matches!(
        translator.error(),
        Some(AgentError::Provider { status: 400, .. })
    ));
    assert!(translator.take_error().is_some());
    assert!(translator.error().is_none());

    let (_, fallback) = run(WireKind::OpenAiResponses, "event: error\ndata: {}\n\n");
    assert!(fallback
        .error()
        .expect("terminal response error")
        .to_string()
        .contains("OpenAI response stream failed"));
}

#[test]
fn responses_wire_selects_the_responses_translator() {
    let wire = Wire::OpenAiResponses {
        base_url: crate::provider::OPENAI_BASE.into(),
    };
    assert_eq!(WireKind::from(&wire), WireKind::OpenAiResponses);
}

#[test]
fn streamed_usage_counters_saturate_instead_of_wrapping() {
    let raw = "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":18446744073709551615,\"completion_tokens\":18446744073709551615}}\n\ndata: [DONE]\n\n";
    let (_, translator) = run(WireKind::OpenAi, raw);

    assert_eq!(translator.usage().input, u32::MAX);
    assert_eq!(translator.usage().output, u32::MAX);
}

#[test]
fn openai_tool_call_fragments_reassemble_into_one_document() {
    let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"{\\\"pa\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"th\\\":\\\"main.tex\\\"}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
    let (events, translator) = run(WireKind::OpenAi, raw);
    assert_eq!(
        translator.tool_calls(),
        vec![ToolCall {
            id: "call_a".into(),
            name: "read_file".into(),
            arguments: "{\"path\":\"main.tex\"}".into(),
            ..Default::default()
        }]
    );
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::ToolCallEnd { arguments, .. } if arguments == "{\"path\":\"main.tex\"}"
    )));
}

#[test]
fn two_parallel_openai_tool_calls_stay_separate() {
    let raw = concat!(
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[",
            "{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"x\"}},",
            "{\"index\":1,\"id\":\"b\",\"function\":{\"name\":\"list_files\",\"arguments\":\"{\\\"y\"}}",
            "]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":1,\"function\":{\"arguments\":\"\\\":2}\"}}]}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\"\\\":1}\"}}]}}]}\n\n",
            "data: [DONE]\n\n"
        );
    let (_, translator) = run(WireKind::OpenAi, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 2);
    let by_name = |n: &str| {
        calls
            .iter()
            .find(|c| c.name == n)
            .unwrap()
            .arguments
            .clone()
    };
    assert_eq!(by_name("read_file"), "{\"x\":1}");
    assert_eq!(by_name("list_files"), "{\"y\":2}");
}

#[test]
fn provider_tool_calls_are_bounded_during_stream_translation() {
    let calls: Vec<Value> = (0..=MAX_STREAM_TOOL_CALLS)
        .map(|index| {
            serde_json::json!({
                "index": index,
                "id": format!("call_{index}"),
                "function": { "name": "read_file", "arguments": "{}" }
            })
        })
        .collect();
    let raw = format!(
        "data: {}\n\n",
        serde_json::json!({ "choices": [{ "delta": { "tool_calls": calls } }] })
    );

    let (_, translator) = run(WireKind::OpenAi, &raw);
    assert_eq!(translator.tool_calls().len(), MAX_STREAM_TOOL_CALLS);
    let error = translator
        .error()
        .expect("the safety limit must fail closed");
    assert!(matches!(error, AgentError::Decode(_)));
    assert!(!error.retryable());
}

#[test]
fn a_reply_with_more_calls_than_a_turn_runs_is_still_decoded() {
    let calls: Vec<Value> = (0..MAX_TOOL_CALLS_PER_TURN + 8)
        .map(|index| {
            serde_json::json!({
                "index": index,
                "id": format!("call_{index}"),
                "function": { "name": "read_file", "arguments": "{}" }
            })
        })
        .collect();
    let raw = format!(
        "data: {}\n\ndata: [DONE]\n\n",
        serde_json::json!({ "choices": [{ "delta": { "tool_calls": calls } }] })
    );

    let (_, translator) = run(WireKind::OpenAi, &raw);
    assert!(translator.error().is_none());
    assert_eq!(translator.tool_calls().len(), MAX_TOOL_CALLS_PER_TURN + 8);
}

#[test]
fn anthropic_text_and_thinking_split_by_delta_type() {
    let raw = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9,\"cache_read_input_tokens\":4,\"cache_creation_input_tokens\":2}}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"hmm\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Hi \"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"there\"}}\n\n",
            "event: message_delta\ndata: {\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":6}}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
    let (events, translator) = run(WireKind::Anthropic, raw);
    assert_eq!(text_of(&events), "Hi there");
    assert_eq!(reasoning_of(&events), "hmm");
    assert_eq!(
        translator.usage(),
        Usage {
            input: 9,
            output: 6,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(4),
            cache_write: Some(2),
            input_semantics: crate::complete::InputTokenSemantics::Exclusive,
            reasoning: None,
        }
    );
    assert_eq!(translator.stop_reason().as_deref(), Some("end_turn"));
}

#[test]
fn anthropic_tool_use_blocks_reassemble() {
    let raw = concat!(
            "event: content_block_start\ndata: {\"index\":1,\"content_block\":{\"type\":\"tool_use\",\"id\":\"toolu_1\",\"name\":\"write_file\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\"{\\\"path\\\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":1,\"delta\":{\"type\":\"input_json_delta\",\"partial_json\":\":\\\"a.tex\\\"}\"}}\n\n",
            "event: content_block_stop\ndata: {\"index\":1}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
    let (_, translator) = run(WireKind::Anthropic, raw);
    assert_eq!(
        translator.tool_calls(),
        vec![ToolCall {
            id: "toolu_1".into(),
            name: "write_file".into(),
            arguments: "{\"path\":\"a.tex\"}".into(),
            ..Default::default()
        }]
    );
}

#[test]
fn a_text_content_block_stop_does_not_invent_a_tool_call() {
    let raw = concat!(
            "event: content_block_start\ndata: {\"index\":0,\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n",
            "event: content_block_delta\ndata: {\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n",
            "event: content_block_stop\ndata: {\"index\":0}\n\n",
            "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
        );
    let (events, translator) = run(WireKind::Anthropic, raw);
    assert!(translator.tool_calls().is_empty());
    assert!(!events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCallEnd { .. })));
}

#[test]
fn an_authentication_stream_error_is_not_offered_as_retryable() {
    let raw = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"authentication_error\",\"message\":\"bad key\"}}\n\n";
    let (_, translator) = run(WireKind::Anthropic, raw);
    let error = translator.error().expect("the error must be terminal");
    assert!(!error.retryable());
    assert_eq!(error.kind(), "auth");
    assert!(error.to_string().contains("bad key"));
}

#[test]
fn an_overloaded_stream_error_stays_retryable() {
    let raw = "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"busy\"}}\n\n";
    let (_, translator) = run(WireKind::Anthropic, raw);
    let error = translator.error().expect("the error must be terminal");
    assert!(error.retryable());
}

#[test]
fn anthropic_stream_errors_stop_the_turn() {
    let raw = "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\n";
    let (events, translator) = run(WireKind::Anthropic, raw);
    assert!(translator.error().is_some());
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Done { .. })));
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Error { .. })));
}

#[test]
fn malformed_stream_json_becomes_a_decode_error_not_a_silent_skip() {
    let raw = "data: {\"choices\": [{\"delta\": {\"content\": \"hi\"}\n\n";
    let (_, translator) = run(WireKind::OpenAi, raw);
    let error = translator.error().expect("garbage data must surface");
    assert_eq!(error.kind(), "decode");
}

#[test]
fn an_event_with_no_data_is_not_a_decode_error() {
    let raw = "event: ping\ndata: {\"type\": \"ping\"}\n\n";
    let (_, translator) = run(WireKind::Anthropic, raw);
    assert!(translator.error().is_none());
}

#[test]
fn google_parts_stream_as_text() {
    let raw = concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hel\"}]}}]}\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2,\"cachedContentTokenCount\":1}}\n\n"
        );
    let (events, translator) = run(WireKind::Google, raw);
    assert_eq!(text_of(&events), "Hello");
    assert_eq!(translator.stop_reason().as_deref(), Some("STOP"));
    assert_eq!(
        translator.usage(),
        Usage {
            input: 3,
            output: 2,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(1),
            cache_write: Some(0),
            input_semantics: crate::complete::InputTokenSemantics::Inclusive,
            reasoning: None,
        }
    );
}

#[test]
fn google_function_calls_arrive_whole() {
    let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{\"path\":\"main.tex\"}}}]}}]}\n\n";
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].name, "read_file");
    assert_eq!(
        serde_json::from_str::<Value>(&calls[0].arguments).unwrap()["path"],
        "main.tex"
    );
    assert_eq!(calls[0].thought_signature, None);
}

#[test]
fn google_thought_parts_stream_as_reasoning_not_answer_text() {
    let raw = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"planning the search\",\"thought\":true}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Here are the papers.\"}]},\"finishReason\":\"STOP\"}]}\n\n"
    );
    let (events, _) = run(WireKind::Google, raw);
    assert_eq!(text_of(&events), "Here are the papers.");
    assert!(events.iter().any(|e| matches!(
        e,
        AgentEvent::ReasoningDelta { text } if text == "planning the search"
    )));
}

#[test]
fn a_google_function_call_keeps_its_part_level_thought_signature() {
    let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{}},\"thoughtSignature\":\"sig-1\"}]}}]}\n\n";
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].thought_signature.as_deref(), Some("sig-1"));
}

#[test]
fn a_signature_on_a_thought_part_is_not_moved_to_a_following_call() {
    let raw = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"planning\",\"thought\":true,\"thoughtSignature\":\"sig-t\"}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{}}}]}}]}\n\n"
    );
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls[0].thought_signature, None);
}

#[test]
fn a_trailing_signature_only_part_does_not_backfill_an_unsigned_call() {
    let raw = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{}}}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\",\"thoughtSignature\":\"sig-late\"}]}}]}\n\n"
    );
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls[0].thought_signature, None);
}

#[test]
fn a_signed_call_is_never_overwritten_by_a_stray_signature() {
    let raw = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"f\",\"args\":{}},\"thoughtSignature\":\"sig-own\"},{\"functionCall\":{\"name\":\"f\",\"args\":{}}}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"\",\"thoughtSignature\":\"sig-stray\"}]}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"later\",\"args\":{}}}]}}]}\n\n"
    );
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls[0].thought_signature.as_deref(), Some("sig-own"));
    assert_eq!(calls[1].thought_signature, None);
    assert_eq!(calls[2].thought_signature, None);
}

#[test]
fn parallel_google_calls_keep_the_signature_only_where_it_arrived() {
    let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"f\",\"args\":{}},\"thoughtSignature\":\"sig-first\"},{\"functionCall\":{\"name\":\"f\",\"args\":{}}}]}}]}\n\n";
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].thought_signature.as_deref(), Some("sig-first"));
    assert_eq!(calls[1].thought_signature, None);
}

#[test]
fn two_google_function_calls_get_distinct_ids() {
    let raw = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"f\",\"args\":{}}},{\"functionCall\":{\"name\":\"f\",\"args\":{}}}]}}]}\n\n";
    let (_, translator) = run(WireKind::Google, raw);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 2);
    assert_ne!(calls[0].id, calls[1].id);
}

#[test]
fn a_truncated_stream_still_closes_its_open_tool_call() {
    let raw = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"a\",\"function\":{\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"x\\\"}\"}}]}}]}\n\n";
    let (events, translator) = run(WireKind::OpenAi, raw);
    assert_eq!(translator.tool_calls().len(), 1);
    assert!(events
        .iter()
        .any(|e| matches!(e, AgentEvent::ToolCallEnd { .. })));
    assert!(matches!(events.last(), Some(AgentEvent::Done { .. })));
}

#[test]
fn unparsable_payloads_are_skipped_rather_than_failing_the_turn() {
    let raw = concat!(
        "data: not json\n\n",
        "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\n",
        "data: [DONE]\n\n"
    );
    let (events, _) = run(WireKind::OpenAi, raw);
    assert_eq!(text_of(&events), "ok");
}

#[test]
fn stream_bodies_ask_for_streaming_and_usage_only_where_supported() {
    let req = CompletionRequest::prompt("s", "u");

    let catalog = Resolved {
        provider_id: "groq".into(),
        model_id: "m".into(),
        credential: "k".into(),
        auth: Some("k".into()),
        wire: Wire::OpenAiChat {
            base_url: "https://api.groq.com/openai/v1".into(),
            reasoning_content: false,
        },
        caps: crate::caps::ModelCaps::default(),
    };
    let body = stream_body(&catalog, &req).unwrap();
    assert_eq!(body["stream"], true);
    assert_eq!(body["stream_options"]["include_usage"], true);

    let custom = Resolved {
        provider_id: "my-server".into(),
        ..catalog.clone()
    };
    let body = stream_body(&custom, &req).unwrap();
    assert_eq!(body["stream"], true);
    assert!(body.get("stream_options").is_none());

    let responses = Resolved {
        provider_id: "openai".into(),
        model_id: "any-model".into(),
        credential: "k".into(),
        auth: Some("k".into()),
        wire: Wire::OpenAiResponses {
            base_url: crate::provider::OPENAI_BASE.into(),
        },
        caps: crate::caps::ModelCaps::default(),
    };
    let body = stream_body(&responses, &req).unwrap();
    assert_eq!(body["stream"], true);
    assert_eq!(body["store"], false);
    assert!(body.get("stream_options").is_none());
}

#[test]
fn google_stream_body_carries_no_stream_flag() {
    let req = CompletionRequest::prompt("s", "u");
    let resolved = Resolved {
        provider_id: "google".into(),
        model_id: "gemini-3.5-flash-lite".into(),
        credential: "k".into(),
        auth: Some("k".into()),
        wire: Wire::Google {
            base_url: crate::provider::GOOGLE_BASE.into(),
        },
        caps: crate::caps::ModelCaps::default(),
    };
    let body = stream_body(&resolved, &req).unwrap();
    assert!(body.get("stream").is_none());
    assert!(body.get("contents").is_some());
}

#[test]
fn endpoint_locality_controls_the_default_idle_timeout_independently_of_auth() {
    let local = Resolved {
        provider_id: "private-model-server".into(),
        model_id: "llama3.2".into(),
        credential: "local-key".into(),
        auth: Some("local-key".into()),
        wire: Wire::OpenAiChat {
            base_url: "http://127.0.0.1:11434/v1".into(),
            reasoning_content: false,
        },
        caps: crate::caps::ModelCaps::default(),
    };
    let cloud = Resolved {
        provider_id: "groq".into(),
        credential: String::new(),
        auth: None,
        wire: Wire::OpenAiChat {
            base_url: "https://models.example/v1".into(),
            reasoning_content: false,
        },
        ..local.clone()
    };

    assert_eq!(default_idle_timeout(&local), Duration::from_secs(360));
    assert_eq!(default_idle_timeout(&cloud), Duration::from_secs(120));
}

#[test]
fn a_custom_provider_on_a_lan_host_gets_the_self_hosted_idle_timeout() {
    let custom = |base_url: &str| Resolved {
        provider_id: "lemonade".into(),
        model_id: "Qwen3-8B".into(),
        credential: String::new(),
        auth: None,
        wire: Wire::OpenAiChat {
            base_url: base_url.into(),
            reasoning_content: true,
        },
        caps: crate::caps::ModelCaps::default(),
    };
    for base_url in [
        "http://box.lan:8080/v1",
        "http://box.local:13305/v1",
        "http://100.64.12.5:8080/v1",
        "http://host.docker.internal:1234/v1",
    ] {
        let resolved = custom(base_url);
        assert!(!resolved.is_local_endpoint(), "{base_url}");
        assert_eq!(
            default_idle_timeout(&resolved),
            Duration::from_secs(360),
            "{base_url}"
        );
    }

    // A hosted catalog provider keeps the cloud default.
    let hosted = Resolved {
        provider_id: "openai".into(),
        wire: Wire::OpenAiResponses {
            base_url: crate::provider::OPENAI_BASE.into(),
        },
        ..custom("http://unused")
    };
    assert_eq!(default_idle_timeout(&hosted), Duration::from_secs(120));
}

#[test]
fn streaming_usage_preserves_presence_and_anthropic_zero_updates() {
    let (_, absent) = run(
        WireKind::OpenAi,
        "data: {\"choices\":[]}\n\ndata: [DONE]\n\n",
    );
    assert_eq!(absent.usage().reported_input(), None);
    assert_eq!(absent.usage().reported_output(), None);
    let (_, partial) = run(
        WireKind::OpenAi,
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":0}}\n\n",
    );
    assert_eq!(partial.usage().reported_input(), Some(0));
    assert_eq!(partial.usage().reported_output(), None);
    let (_, merged) = run(WireKind::OpenAi, "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":4}}\n\ndata: {\"choices\":[],\"usage\":{\"completion_tokens\":0}}\n\n");
    assert_eq!(merged.usage().reported_input(), Some(4));
    assert_eq!(merged.usage().reported_output(), Some(0));
    let (_, anthropic) = run(WireKind::Anthropic, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":4}}}\n\nevent: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":0}}\n\n");
    assert_eq!(anthropic.usage().reported_input(), Some(4));
    assert_eq!(anthropic.usage().reported_output(), Some(0));
}

#[test]
fn google_streams_count_thinking_tokens_as_output_and_default_absent_cache_to_zero() {
    let raw = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"plan\",\"thought\":true}]}}],\"usageMetadata\":{\"promptTokenCount\":3,\"thoughtsTokenCount\":7}}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2,\"thoughtsTokenCount\":7}}\n\n"
    );
    let (events, translator) = run(WireKind::Google, raw);
    assert_eq!(text_of(&events), "Hi");
    assert_eq!(
        translator.usage(),
        Usage {
            input: 3,
            output: 9,
            input_known: Some(true),
            output_known: Some(true),
            cache_read: Some(0),
            cache_write: Some(0),
            input_semantics: crate::complete::InputTokenSemantics::Inclusive,
            reasoning: Some(7),
        }
    );
    let usage_events: Vec<Usage> = events
        .iter()
        .filter_map(|event| match event {
            AgentEvent::Usage { usage, .. } => Some(*usage),
            _ => None,
        })
        .collect();
    assert_eq!(usage_events[0].reported_output(), Some(7));
}

#[test]
fn openai_compatible_streams_leave_unreported_cache_reads_unknown() {
    let (_, groq) = run(
        WireKind::OpenAi,
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n",
    );
    assert_eq!(groq.usage().cache_read, None);
    assert_eq!(groq.usage().cache_write, Some(0));
    let (_, deepseek) = run(
        WireKind::OpenAi,
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":4,\"prompt_cache_hit_tokens\":6}}\n\ndata: [DONE]\n\n",
    );
    assert_eq!(deepseek.usage().cache_read, Some(6));
}

// --- 0.4.8: block recorder, server tools, usage details --------------------

fn sse(events: &[&str]) -> String {
    events
        .iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect()
}

fn outcome_from(kind: WireKind, raw: &str) -> (Vec<AgentEvent>, StreamOutcome) {
    let (events, mut translator) = run(kind, raw);
    let mut outcome = StreamOutcome::default();
    for event in &events {
        accumulate(&mut outcome, event);
    }
    outcome.usage = translator.usage();
    outcome.tool_calls = translator.tool_calls();
    outcome.response_items = translator.response_items();
    outcome.stop_reason = translator.stop_reason();
    outcome.blocks = translator.take_blocks();
    outcome.container = translator.container();
    outcome.input_transformations = translator.input_transformations();
    outcome.refusal_category = translator.refusal_category();
    (events, outcome)
}

fn five_block_stream() -> String {
    sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"plan"}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"s1"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}"#,
        r#"{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Reading."}}"#,
        r#"{"type":"content_block_stop","index":1}"#,
        r#"{"type":"content_block_start","index":2,"content_block":{"type":"tool_use","id":"t1","name":"read_file","input":{}}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"a\"}"}}"#,
        r#"{"type":"content_block_stop","index":2}"#,
        r#"{"type":"content_block_start","index":3,"content_block":{"type":"thinking","thinking":""}}"#,
        r#"{"type":"content_block_delta","index":3,"delta":{"type":"signature_delta","signature":"s2"}}"#,
        r#"{"type":"content_block_stop","index":3}"#,
        r#"{"type":"content_block_start","index":4,"content_block":{"type":"tool_use","id":"t2","name":"read_file","input":{}}}"#,
        r#"{"type":"content_block_delta","index":4,"delta":{"type":"input_json_delta","partial_json":"{\"path\":\"b\"}"}}"#,
        r#"{"type":"content_block_stop","index":4}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

fn web_search_stream() -> String {
    sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{}}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"query\":\"claude shannon\"}"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"content_block_start","index":1,"content_block":{"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":[{"type":"web_search_result","url":"https://en.wikipedia.org/wiki/Claude_Shannon","title":"Claude Shannon - Wikipedia","encrypted_content":"opaque","page_age":"April 30, 2025"}]}}"#,
        r#"{"type":"content_block_stop","index":1}"#,
        r#"{"type":"content_block_start","index":2,"content_block":{"type":"text","text":""}}"#,
        r#"{"type":"content_block_delta","index":2,"delta":{"type":"text_delta","text":"Found it."}}"#,
        r#"{"type":"content_block_stop","index":2}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

fn web_search_error_stream(code: &str) -> String {
    let result = format!(
        r#"{{"type":"content_block_start","index":1,"content_block":{{"type":"web_search_tool_result","tool_use_id":"srvtoolu_1","content":{{"type":"web_search_tool_result_error","error_code":"{code}"}}}}}}"#
    );
    sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"server_tool_use","id":"srvtoolu_1","name":"web_search","input":{"query":"q"}}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        &result,
        r#"{"type":"content_block_stop","index":1}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

fn cited_text_stream() -> String {
    sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Shannon was born in 1916."}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://en.wikipedia.org/wiki/Claude_Shannon","title":"Claude Shannon - Wikipedia","encrypted_index":"i","cited_text":"born April 30, 1916"}}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"citations_delta","citation":{"type":"web_search_result_location","url":"https://en.wikipedia.org/wiki/Claude_Shannon","title":"Claude Shannon - Wikipedia","encrypted_index":"j","cited_text":"1916"}}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"message_stop"}"#,
    ])
}

#[test]
fn anthropic_thinking_signatures_are_captured_with_empty_text() {
    let raw = sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}"#,
        r#"{"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"message_stop"}"#,
    ]);
    let (_, outcome) = outcome_from(WireKind::Anthropic, &raw);
    assert_eq!(
        outcome.blocks,
        vec![AssistantBlock::Thinking {
            thinking: String::new(),
            signature: "sig".into()
        }]
    );
}

#[test]
fn anthropic_blocks_keep_their_stream_order() {
    let (_, outcome) = outcome_from(WireKind::Anthropic, &five_block_stream());
    assert!(matches!(
        outcome.blocks.as_slice(),
        [
            AssistantBlock::Thinking { .. },
            AssistantBlock::Text(_),
            AssistantBlock::ToolUse { .. },
            AssistantBlock::Thinking { .. },
            AssistantBlock::ToolUse { .. }
        ]
    ));
    assert_eq!(outcome.tool_calls.len(), 2);
}

#[test]
fn redacted_thinking_is_kept_verbatim() {
    let raw = sse(&[
        r#"{"type":"content_block_start","index":0,"content_block":{"type":"redacted_thinking","data":"opaque"}}"#,
        r#"{"type":"content_block_stop","index":0}"#,
        r#"{"type":"message_stop"}"#,
    ]);
    let (_, outcome) = outcome_from(WireKind::Anthropic, &raw);
    assert_eq!(
        outcome.blocks,
        vec![AssistantBlock::RedactedThinking("opaque".into())]
    );
}

#[test]
fn server_tool_use_is_announced_but_never_executed() {
    let (events, outcome) = outcome_from(WireKind::Anthropic, &web_search_stream());
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolCallStart { name, .. } if name == "web_search")
    ));
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolCallEnd { arguments, .. } if arguments.contains("\"query\""))
    ));
    assert!(outcome.tool_calls.is_empty());
    assert!(outcome.blocks.iter().any(|block| matches!(
        block,
        AssistantBlock::Native(value)
            if value["type"] == "server_tool_use" && value["input"]["query"] == "claude shannon"
    )));
}

#[test]
fn web_search_results_become_a_tool_outcome_summary() {
    let (events, _) = outcome_from(WireKind::Anthropic, &web_search_stream());
    let output = events
        .iter()
        .find_map(|event| match event {
            AgentEvent::ToolOutcome { output, .. } => Some(output.clone()),
            _ => None,
        })
        .unwrap();
    assert!(output.contains("https://en.wikipedia.org/wiki/Claude_Shannon"));
    assert!(!output.contains("encrypted_content") && !output.contains("opaque"));
    let (errors, _) = outcome_from(
        WireKind::Anthropic,
        &web_search_error_stream("max_uses_exceeded"),
    );
    assert!(errors.iter().any(|event| matches!(
        event,
        AgentEvent::ToolOutcome { output, .. } if output == r#"{"error":"max_uses_exceeded"}"#
    )));
}

#[test]
fn cited_text_gets_markdown_source_links() {
    let (events, outcome) = outcome_from(WireKind::Anthropic, &cited_text_stream());
    assert!(text_of(&events).ends_with(
        " ([Claude Shannon - Wikipedia](https://en.wikipedia.org/wiki/Claude_Shannon))"
    ));
    assert_eq!(
        text_of(&events).matches("https://en.wikipedia.org").count(),
        1,
        "one link per distinct source"
    );
    assert!(outcome.blocks.iter().any(|block| matches!(
        block,
        AssistantBlock::Cited(value) if value["citations"][0]["cited_text"].is_string()
            && value["text"] == "Shannon was born in 1916."
    )));
}

#[test]
fn message_delta_usage_updates_input_and_cache_counts() {
    let raw = sse(&[
        r#"{"type":"message_start","message":{"usage":{"input_tokens":3}}}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":50,"cache_read_input_tokens":7,"output_tokens":9}}"#,
        r#"{"type":"message_stop"}"#,
    ]);
    let (_, outcome) = outcome_from(WireKind::Anthropic, &raw);
    assert_eq!(outcome.usage.input, 50);
    assert_eq!(outcome.usage.cache_read, Some(7));
    assert_eq!(outcome.usage.output, 9);
}

#[test]
fn input_transformations_container_and_refusals_are_recorded() {
    let raw = sse(&[
        r#"{"type":"message_start","message":{"usage":{"input_tokens":3},"input_transformations":[{"type":"truncation"}],"container":{"id":"cntr_1"}}}"#,
        r#"{"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"category":"bio"},"container":{"id":"cntr_2"}},"usage":{"output_tokens":0}}"#,
        r#"{"type":"message_stop"}"#,
    ]);
    let (_, outcome) = outcome_from(WireKind::Anthropic, &raw);
    assert_eq!(outcome.input_transformations.len(), 1);
    assert_eq!(outcome.container.as_deref(), Some("cntr_2"));
    assert_eq!(outcome.refusal_category.as_deref(), Some("bio"));
    assert_eq!(outcome.stop_reason.as_deref(), Some("refusal"));
}

#[test]
fn responses_web_search_calls_render_as_tool_events_without_execution() {
    let raw = concat!(
        "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"output_index\":0,\"item\":{\"type\":\"web_search_call\",\"id\":\"ws_1\",\"status\":\"in_progress\"}}\n\n",
        "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"output_index\":0,\"item\":{\"type\":\"web_search_call\",\"id\":\"ws_1\",\"status\":\"completed\",\"action\":{\"type\":\"search\",\"query\":\"shannon\",\"sources\":[{\"type\":\"url\",\"url\":\"https://e.org\",\"title\":\"E\"}]}}}\n\n",
        "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"output\":[],\"usage\":{\"input_tokens\":5,\"output_tokens\":7,\"output_tokens_details\":{\"reasoning_tokens\":4}}}}\n\n"
    );
    let (events, outcome) = outcome_from(WireKind::OpenAiResponses, raw);
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolCallStart { id, name } if id == "ws_1" && name == "web_search")
    ));
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolCallEnd { arguments, .. } if arguments.contains("shannon"))
    ));
    assert!(events.iter().any(
        |event| matches!(event, AgentEvent::ToolOutcome { output, .. } if output.contains("https://e.org"))
    ));
    assert!(outcome.tool_calls.is_empty());
    assert_eq!(outcome.response_items.len(), 1);
    assert_eq!(outcome.usage.reasoning, Some(4));
}

#[test]
fn reasoning_token_counts_are_read_from_each_wire() {
    let (_, chat) = run(
        WireKind::OpenAi,
        "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":20,\"completion_tokens_details\":{\"reasoning_tokens\":12}}}\n\ndata: [DONE]\n\n",
    );
    assert_eq!(chat.usage().reasoning, Some(12));
    let (_, google) = run(
        WireKind::Google,
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"a\"}]}}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":1,\"thoughtsTokenCount\":30}}\n\n",
    );
    assert_eq!(google.usage().reasoning, Some(30));
}

#[test]
fn output_limit_and_refusal_stops_are_recognised_on_every_wire() {
    for reason in ["length", "max_tokens", "max_output_tokens", "MAX_TOKENS"] {
        assert!(is_output_limit_stop(Some(reason)), "{reason}");
    }
    for reason in ["stop", "tool_calls", "end_turn", "completed", "STOP"] {
        assert!(!is_output_limit_stop(Some(reason)), "{reason}");
    }
    for reason in ["refusal", "content_filter", "SAFETY"] {
        assert!(is_refusal_stop(Some(reason)), "{reason}");
    }
    assert!(!is_refusal_stop(None));
}

#[test]
fn a_reply_cut_off_by_the_context_window_is_an_output_limit_stop() {
    assert!(is_output_limit_stop(Some("model_context_window_exceeded")));
}

#[test]
fn made_up_call_ids_differ_from_one_stream_to_the_next() {
    let gemini = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"functionCall\":{\"name\":\"read_file\",\"args\":{}}}]}}]}\n\n";
    let (_, first) = run(WireKind::Google, gemini);
    let (_, second) = run(WireKind::Google, gemini);
    assert_ne!(first.tool_calls()[0].id, second.tool_calls()[0].id);
    let chat = "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read_file\",\"arguments\":\"{}\"}}]}}]}\n\n";
    let (_, first) = run(WireKind::OpenAi, chat);
    let (_, second) = run(WireKind::OpenAi, chat);
    assert_ne!(first.tool_calls()[0].id, second.tool_calls()[0].id);
}

#[test]
fn a_chat_error_frame_ends_the_stream_with_the_servers_message_and_status() {
    // llama.cpp, LM Studio and Lemonade report a failure as a frame of its own.
    let raw = sse(&[
        r#"{"choices":[{"delta":{"content":"partial"}}]}"#,
        r#"{"error":{"message":"Model failed to load: out of memory","type":"server_error","code":500}}"#,
    ]);
    let (events, mut translator) = run(WireKind::OpenAi, &raw);
    assert_eq!(text_of(&events), "partial");
    assert!(!events.iter().any(|e| matches!(e, AgentEvent::Done { .. })));
    let error = translator
        .take_error()
        .expect("the error frame is terminal");
    assert!(
        matches!(error, AgentError::Provider { status: 500, .. }),
        "{error:?}"
    );
    assert!(error.retryable());
    assert!(
        error
            .to_string()
            .contains("Model failed to load: out of memory"),
        "{error}"
    );
}

#[test]
fn a_chat_error_frame_takes_its_status_from_a_numeric_code() {
    let (_, bad_request) = run(
        WireKind::OpenAi,
        &sse(&[
            r#"{"error":{"code":400,"message":"the request exceeds the available context size, try increasing it","type":"exceed_context_size_error"}}"#,
        ]),
    );
    let error = bad_request.error().expect("a stream error");
    assert!(
        matches!(error, AgentError::Provider { status: 400, .. }),
        "{error:?}"
    );
    assert!(!error.retryable());
    assert!(error.is_context_overflow());

    let (_, textual_code) = run(
        WireKind::OpenAi,
        &sse(&[r#"{"error":{"message":"Slow down.","code":"503"}}"#]),
    );
    assert_eq!(textual_code.error().unwrap().status(), Some(503));

    for code in [
        r#""code":"invalid_request""#,
        r#""code":200"#,
        r#""code":0"#,
        r#""code":70000"#,
        r#""code":null"#,
        r#""type":"server_error""#,
    ] {
        let (_, other) = run(
            WireKind::OpenAi,
            &sse(&[&format!(r#"{{"error":{{"message":"boom",{code}}}}}"#)]),
        );
        assert_eq!(other.error().unwrap().status(), Some(500), "{code}");
    }
}

#[test]
fn a_chat_error_frame_may_be_a_plain_string() {
    let (events, translator) = run(
        WireKind::OpenAi,
        &sse(&[r#"{"error":"The model has crashed without additional information."}"#]),
    );
    assert!(events.is_empty());
    let error = translator.error().expect("a stream error");
    assert!(
        matches!(error, AgentError::Provider { status: 500, .. }),
        "{error:?}"
    );
    assert!(error
        .to_string()
        .contains("The model has crashed without additional information."));

    // An error object with no message still says what the server called it.
    let (_, typed) = run(
        WireKind::OpenAi,
        &sse(&[r#"{"error":{"type":"overloaded_error"}}"#]),
    );
    assert!(typed
        .error()
        .unwrap()
        .to_string()
        .contains("overloaded_error"));
}

#[test]
fn an_empty_or_null_error_field_on_a_chat_chunk_is_not_a_failure() {
    let raw = sse(&[
        r#"{"error":null,"choices":[{"delta":{"content":"a"}}]}"#,
        r#"{"error":"","choices":[{"delta":{"content":"b"}}]}"#,
        r#"{"error":{},"choices":[{"delta":{"content":"c"},"finish_reason":"stop"}]}"#,
        "[DONE]",
    ]);
    let (events, translator) = run(WireKind::OpenAi, &raw);
    assert!(translator.error().is_none());
    assert_eq!(text_of(&events), "abc");
}

#[test]
fn a_chat_error_frame_fails_the_stream_with_the_provider_error_not_a_dropped_connection() {
    let raw = sse(&[r#"{"error":{"message":"slot unavailable","code":503}}"#]);
    let mut state = StreamState::new(Translator::new(WireKind::OpenAi));
    let mut events = Vec::new();
    state
        .push(raw.as_bytes(), &mut |event| events.push(event))
        .unwrap();
    assert!(state.translator.error().is_some());
    state.finish(&mut |event| events.push(event)).unwrap();

    let error = finalize(
        state.translator,
        state.outcome,
        &mut state.budget,
        &mut |event| events.push(event),
    )
    .unwrap_err();
    assert!(
        matches!(&error, AgentError::Provider { status: 503, message, .. } if message == "slot unavailable"),
        "{error:?}"
    );
}

#[test]
fn a_responses_stream_failure_keeps_its_code_and_message() {
    let (_, limited) = run(
        WireKind::OpenAiResponses,
        "event: error\ndata: {\"type\":\"error\",\"code\":\"rate_limit_exceeded\",\"message\":\"Slow down.\"}\n\n",
    );
    let error = limited.error().expect("a stream error");
    assert!(
        matches!(error, AgentError::Provider { status: 429, .. }),
        "{error:?}"
    );
    assert!(error.retryable());
    assert!(error.to_string().contains("Slow down."), "{error}");

    let (_, server) = run(
        WireKind::OpenAiResponses,
        "event: response.failed\ndata: {\"response\":{\"error\":{\"code\":\"server_error\",\"message\":\"Try again.\"}}}\n\n",
    );
    assert!(server.error().unwrap().retryable());

    let (_, overflow) = run(
        WireKind::OpenAiResponses,
        "event: response.failed\ndata: {\"response\":{\"error\":{\"code\":\"context_length_exceeded\",\"message\":\"Your input exceeds the limit.\"}}}\n\n",
    );
    assert!(overflow.error().unwrap().is_context_overflow());
}

fn offered(names: &[&str]) -> Vec<crate::tool::ToolSchema> {
    names
        .iter()
        .map(|name| crate::tool::ToolSchema {
            name: name.to_string(),
            description: String::new(),
            input_schema: serde_json::json!({ "type": "object" }),
        })
        .collect()
}

fn run_offering(kind: WireKind, raw: &str, tools: &[&str]) -> (Vec<AgentEvent>, Translator) {
    let mut translator = Translator::new(kind).offering(&offered(tools));
    let mut decoder = SseDecoder::new();
    let mut events = Vec::new();
    for event in decoder.push(raw).unwrap() {
        events.extend(translator.translate(&event));
    }
    events.extend(translator.finish());
    (events, translator)
}

/// What Lemonade's llama.cpp streams for Bonsai-4B when it calls a tool.
fn text_call_stream() -> String {
    sse(&[
        r#"{"choices":[{"delta":{"role":"assistant","content":"{\"name\": \"ping\", "}}]}"#,
        r#"{"choices":[{"delta":{"content":"\"arguments\": {}}"}}]}"#,
        r#"{"choices":[{"delta":{"content":" </tool_call>"}}]}"#,
        r#"{"choices":[{"delta":{},"finish_reason":"stop"}]}"#,
        "[DONE]",
    ])
}

#[test]
fn a_tool_call_written_as_chat_text_becomes_a_tool_call() {
    let (events, translator) = run_offering(WireKind::OpenAi, &text_call_stream(), &["ping"]);
    assert_eq!(text_of(&events), "");
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(
        (calls[0].name.as_str(), calls[0].arguments.as_str()),
        ("ping", "{}")
    );
    assert!(calls[0].id.starts_with("call_ping_"), "{}", calls[0].id);
    assert_eq!(translator.stop_reason().as_deref(), Some("tool_calls"));
    assert!(matches!(
        events.as_slice(),
        [
            AgentEvent::ToolCallStart { .. },
            AgentEvent::ToolCallArgsDelta { .. },
            AgentEvent::ToolCallEnd { .. },
            AgentEvent::Done { .. }
        ]
    ));
}

#[test]
fn a_text_call_is_left_as_text_without_offered_tools_or_on_other_wires() {
    let (events, translator) = run(WireKind::OpenAi, &text_call_stream());
    assert_eq!(
        text_of(&events),
        r#"{"name": "ping", "arguments": {}} </tool_call>"#
    );
    assert!(translator.tool_calls().is_empty());

    let (events, translator) = run_offering(WireKind::OpenAi, &text_call_stream(), &["read_file"]);
    assert_eq!(
        text_of(&events),
        r#"{"name": "ping", "arguments": {}} </tool_call>"#
    );
    assert!(translator.tool_calls().is_empty());
    assert_eq!(translator.stop_reason().as_deref(), Some("stop"));

    let google = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"{\\\"name\\\": \\\"ping\\\"}\"}]}}]}\n\n";
    let (events, translator) = run_offering(WireKind::Google, google, &["ping"]);
    assert_eq!(text_of(&events), r#"{"name": "ping"}"#);
    assert!(translator.tool_calls().is_empty());
}

#[test]
fn structured_calls_win_over_text_that_looks_like_one() {
    let raw = sse(&[
        r#"{"choices":[{"delta":{"content":"{\"name\": \"ping\", \"arguments\": {}}"}}]}"#,
        r#"{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"read_file","arguments":"{}"}}]}}]}"#,
        r#"{"choices":[{"delta":{},"finish_reason":"tool_calls"}]}"#,
        "[DONE]",
    ]);
    let (events, translator) = run_offering(WireKind::OpenAi, &raw, &["ping", "read_file"]);
    assert_eq!(text_of(&events), r#"{"name": "ping", "arguments": {}}"#);
    let calls = translator.tool_calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].id, "call_1");
    assert!(matches!(events.first(), Some(AgentEvent::TextDelta { .. })));
}

#[test]
fn prose_streams_as_it_arrives_while_tools_are_offered() {
    let raw = sse(&[
        r#"{"choices":[{"delta":{"content":"Hello"}}]}"#,
        r#"{"choices":[{"delta":{"content":" there"}}]}"#,
    ]);
    let mut translator = Translator::new(WireKind::OpenAi).offering(&offered(&["ping"]));
    let mut decoder = SseDecoder::new();
    let first: Vec<AgentEvent> = decoder
        .push(&raw)
        .unwrap()
        .iter()
        .flat_map(|event| translator.translate(event))
        .collect();
    assert_eq!(text_of(&first), "Hello there");
    assert!(!translator.holds_text());
}

#[test]
fn a_held_reply_cut_off_without_a_finish_is_still_delivered() {
    let raw = sse(&[r#"{"choices":[{"delta":{"content":"{\"answer\": 42}"}}]}"#]);
    let mut state =
        StreamState::new(Translator::new(WireKind::OpenAi).offering(&offered(&["ping"])));
    let mut events = Vec::new();
    state
        .push(raw.as_bytes(), &mut |event| events.push(event))
        .unwrap();
    assert!(state.translator.holds_text());
    state.finish(&mut |event| events.push(event)).unwrap();
    let outcome = finalize(
        state.translator,
        state.outcome,
        &mut state.budget,
        &mut |event| events.push(event),
    )
    .unwrap();
    assert_eq!(outcome.text, r#"{"answer": 42}"#);
    assert!(outcome.tool_calls.is_empty());
}
