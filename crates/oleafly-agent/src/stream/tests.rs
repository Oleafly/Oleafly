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
    let raw = "data: {\"choices\":[],\"usage\":{\"prompt_tokens\":11,\"completion_tokens\":4}}\n\ndata: [DONE]\n\n";
    let (_, translator) = run(WireKind::OpenAi, raw);
    assert_eq!(
        translator.usage(),
        Usage {
            input: 11,
            output: 4
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
        "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":21,\"output_tokens\":8}}}\n\n",
    );
    let (events, translator) = run(WireKind::OpenAiResponses, raw);
    assert_eq!(reasoning_of(&events), "think");
    assert_eq!(text_of(&events), "answer");
    assert_eq!(
        translator.usage(),
        Usage {
            input: 21,
            output: 8
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
fn anthropic_text_and_thinking_split_by_delta_type() {
    let raw = concat!(
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":9}}}\n\n",
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
            output: 6
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
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"lo\"}]},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":2}}\n\n"
        );
    let (events, translator) = run(WireKind::Google, raw);
    assert_eq!(text_of(&events), "Hello");
    assert_eq!(translator.stop_reason().as_deref(), Some("STOP"));
    assert_eq!(
        translator.usage(),
        Usage {
            input: 3,
            output: 2
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
        model_id: "gemini-2.5-pro".into(),
        credential: "k".into(),
        auth: Some("k".into()),
        wire: Wire::Google {
            base_url: crate::provider::GOOGLE_BASE.into(),
        },
    };
    let body = stream_body(&resolved, &req).unwrap();
    assert!(body.get("stream").is_none());
    assert!(body.get("contents").is_some());
}
