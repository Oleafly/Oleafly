    use super::*;

    fn run(kind: WireKind, raw: &str) -> (Vec<AgentEvent>, Translator) {
        let mut translator = Translator::new(kind);
        let mut decoder = SseDecoder::new();
        let mut events = Vec::new();
        for event in decoder.push(raw) {
            events.extend(translator.translate(&event));
        }
        if let Some(event) = decoder.finish() {
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
        let raw =
            "event: error\ndata: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\n";
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

