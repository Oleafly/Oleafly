use super::*;

fn config_with(provider: &str, keys: &[(&str, &str)]) -> AppConfig {
    AppConfig {
        ai_provider: provider.into(),
        ai_keys: keys
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect(),
        ..AppConfig::default()
    }
}

fn with_custom(provider: &str, key: &str, base_url: &str) -> ProviderConfig {
    let mut cfg = provider_config(&config_with(provider, &[(provider, key)]));
    cfg.custom.push(oleafly_agent::CustomProvider {
        id: provider.into(),
        base_url: base_url.into(),
        key_optional: false,
    });
    cfg
}

#[test]
fn a_stored_key_never_travels_to_a_caller_chosen_endpoint() {
    let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
    assert!(!endpoint_override_allowed(
        &cfg,
        "gateway",
        false,
        &Some("https://attacker.example.com/v1".into())
    ));
}

#[test]
fn supplying_the_key_with_the_endpoint_is_allowed() {
    let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
    assert!(endpoint_override_allowed(
        &cfg,
        "gateway",
        true,
        &Some("https://new.example.com/v1".into())
    ));
}

#[test]
fn a_provider_with_no_stored_key_may_name_its_endpoint() {
    let cfg = provider_config(&AppConfig::default());
    assert!(endpoint_override_allowed(
        &cfg,
        "brand-new",
        false,
        &Some("http://127.0.0.1:8000/v1".into())
    ));
}

#[test]
fn listing_without_an_endpoint_override_is_always_allowed() {
    let cfg = with_custom("gateway", "sk-stored", "https://gateway.example.com/v1");
    assert!(endpoint_override_allowed(&cfg, "gateway", false, &None));
}

#[test]
fn provider_config_carries_every_field_resolution_depends_on() {
    let cfg = AppConfig {
        ai_model: "claude-3-5-haiku-20241022".into(),
        ai_api_key: "legacy".into(),
        ai_provider_models: std::collections::HashMap::from([
            (
                "anthropic".into(),
                vec![
                    crate::config::StoredModel {
                        id: "claude-enabled".into(),
                        name: "Enabled".into(),
                        enabled: true,
                        source: "custom".into(),
                    },
                    crate::config::StoredModel {
                        id: "claude-disabled".into(),
                        name: "Disabled".into(),
                        enabled: false,
                        source: "custom".into(),
                    },
                ],
            ),
            ("explicitly-empty".into(), vec![]),
        ]),
        ai_custom_providers: vec![crate::config::CustomProvider {
            id: "local".into(),
            name: "Local".into(),
            base_url: "http://127.0.0.1:8000/v1".into(),
            key_optional: true,
        }],
        ..config_with("anthropic", &[("anthropic", "sk-ant")])
    };

    let projected = provider_config(&cfg);
    assert_eq!(projected.provider, "anthropic");
    assert_eq!(projected.model, "claude-3-5-haiku-20241022");
    assert_eq!(projected.legacy_key, "legacy");
    assert_eq!(projected.keys.get("anthropic").unwrap(), "sk-ant");
    assert_eq!(
        projected.enabled_models.get("anthropic").unwrap(),
        &["claude-enabled"]
    );
    assert!(projected
        .enabled_models
        .get("explicitly-empty")
        .unwrap()
        .is_empty());
    assert_eq!(projected.custom[0].base_url, "http://127.0.0.1:8000/v1");
    assert!(projected.custom[0].key_optional);
}

#[test]
fn a_configured_key_resolves_end_to_end_from_app_config() {
    let cfg = config_with("groq", &[("groq", "gsk-1")]);
    let resolved = oleafly_agent::resolve(&provider_config(&cfg)).unwrap();
    assert_eq!(resolved.provider_id, "groq");
    assert_eq!(resolved.model_id, "openai/gpt-oss-120b");
    assert_eq!(resolved.credential, "gsk-1");
}

#[test]
fn renderer_run_budgets_are_clamped_to_backend_limits() {
    let config = sanitized_run_config(Some(RunConfig {
        max_steps: u32::MAX,
        max_retries: u32::MAX,
        retry_base_ms: u64::MAX,
        auto_compact: true,
    }));

    assert_eq!(config.max_steps, MAX_RUN_STEPS);
    assert_eq!(config.max_retries, MAX_RUN_RETRIES);
    assert_eq!(config.retry_base_ms, MAX_RETRY_BASE_MS);
    assert!(config.auto_compact);
}

#[test]
fn renderer_run_budgets_have_safe_minimums() {
    let config = sanitized_run_config(Some(RunConfig {
        max_steps: 0,
        max_retries: 0,
        retry_base_ms: 0,
        auto_compact: false,
    }));

    assert_eq!(config.max_steps, 1);
    assert_eq!(config.max_retries, 0);
    assert_eq!(config.retry_base_ms, MIN_RETRY_BASE_MS);
    assert!(!config.auto_compact);
}

#[test]
fn renderer_requests_are_bounded_before_provider_resolution() {
    let request = CompletionRequest {
        messages: vec![oleafly_agent::Message::user(""); 129],
        ..Default::default()
    };

    let error = oleafly_agent::validate_completion_request(&request).unwrap_err();
    assert!(matches!(error, oleafly_agent::AgentError::Decode(_)));
}

#[test]
fn aggregate_agent_concurrency_is_bounded() {
    let state = AgentState::default();
    let permits: Vec<_> = (0..MAX_CONCURRENT_AGENT_REQUESTS)
        .map(|_| acquire_request_slot(&state).unwrap())
        .collect();

    let error = acquire_request_slot(&state).unwrap_err();
    assert!(error.contains("too many concurrent agent requests"));

    drop(permits);
    assert!(acquire_request_slot(&state).is_ok());
}

#[test]
fn tool_bridge_failures_are_structured_for_the_model() {
    let output = tool_error("the tool request could not be delivered");
    let value: serde_json::Value = serde_json::from_str(&output.output).unwrap();

    assert_eq!(value["error"], "the tool request could not be delivered");
    assert!(output.images.is_empty());
}

#[tokio::test]
async fn tool_results_have_a_deadline() {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let error = await_tool_result(receiver, Duration::ZERO)
        .await
        .unwrap_err();
    assert_eq!(error, "the tool execution timed out");
    drop(sender);

    let (sender, receiver) = tokio::sync::oneshot::channel();
    drop(sender);
    let error = await_tool_result(receiver, Duration::from_secs(1))
        .await
        .unwrap_err();
    assert_eq!(error, "the tool was not executed");
}

#[test]
fn tool_results_are_bounded_at_the_command_boundary() {
    let bounded = oleafly_agent::bound_tool_output(ToolOutput {
        output: "x".repeat(128 * 1024),
        images: vec!["data:image/png;base64,AA".into(); 20],
    });

    assert!(bounded.output.len() <= 64 * 1024);
    assert!(bounded.output.contains("backend safety limit"));
    assert!(bounded.images.len() <= 6);
}

#[test]
fn repeated_provider_call_ids_get_distinct_transport_ids() {
    let first = tool_reply_id(7, 0, "call_read_file_1");
    let second = tool_reply_id(7, 1, "call_read_file_1");

    assert_ne!(first, second);
    assert!(first.ends_with("call_read_file_1"));
    assert!(second.ends_with("call_read_file_1"));
}

#[tokio::test]
async fn an_early_cancellation_prevents_work_from_starting() {
    let state = AgentState::default();
    let polled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let _ = cancel_request(&state, "early");

    let observed = polled.clone();
    let result = run_registered(&state, "early", |_| async move {
        observed.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok::<_, String>(())
    })
    .await;

    assert!(result.unwrap_err().starts_with("[cancelled]"));
    assert!(!polled.load(std::sync::atomic::Ordering::SeqCst));
    assert!(lock_or_recover(&state.requests)
        .early_cancellations
        .is_empty());
}

#[tokio::test]
async fn cancel_all_rejects_commands_from_the_previous_renderer_session() {
    let state = AgentState::default();
    cancel_all_requests(&state, "new-session");

    let old_polled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let observed = old_polled.clone();
    let old = run_registered(&state, "agent:old-session:1:uuid", |_| async move {
        observed.store(true, std::sync::atomic::Ordering::SeqCst);
        Ok::<_, String>(())
    })
    .await;
    assert!(old.unwrap_err().starts_with("[cancelled]"));
    assert!(!old_polled.load(std::sync::atomic::Ordering::SeqCst));

    let new = run_registered(&state, "agent:new-session:1:uuid", |_| async {
        Ok::<_, String>(())
    })
    .await;
    assert!(new.is_ok());
}

#[tokio::test]
async fn cancelling_registered_work_aborts_it() {
    let state = AgentState::default();
    let (_, registration) = begin_request(&state, "active").unwrap();
    let _ = cancel_request(&state, "active");

    let outcome = tokio::time::timeout(
        std::time::Duration::from_secs(1),
        Abortable::new(std::future::pending::<()>(), registration),
    )
    .await
    .unwrap();

    assert!(outcome.is_err());
    assert!(lock_or_recover(&state.requests).active.is_empty());
}

#[tokio::test]
async fn an_old_completion_cannot_unregister_a_replacement() {
    let state = AgentState::default();
    let (first_generation, first_registration) = begin_request(&state, "same").unwrap();
    let (second_generation, second_registration) = begin_request(&state, "same").unwrap();

    assert!(
        Abortable::new(std::future::pending::<()>(), first_registration)
            .await
            .is_err()
    );
    finish_request(&state, "same", first_generation);
    assert_eq!(
        lock_or_recover(&state.requests)
            .active
            .get("same")
            .map(|active| active.generation),
        Some(second_generation)
    );

    let _ = cancel_request(&state, "same");
    assert!(
        Abortable::new(std::future::pending::<()>(), second_registration)
            .await
            .is_err()
    );
}

#[test]
fn unmatched_cancellations_are_bounded() {
    let state = AgentState::default();
    for index in 0..=MAX_EARLY_CANCELLATIONS {
        let _ = cancel_request(&state, &format!("pending-{index}"));
    }

    let registry = lock_or_recover(&state.requests);
    assert_eq!(registry.early_cancellations.len(), MAX_EARLY_CANCELLATIONS);
    assert!(!registry
        .early_cancellations
        .iter()
        .any(|request_id| request_id == "pending-0"));
}

#[test]
fn stale_request_cleanup_cannot_remove_replacement_tools() {
    let state = AgentState::default();
    let key = tool_key("same", "call");
    let (sender, _receiver) = tokio::sync::oneshot::channel();
    lock_or_recover(&state.pending_tools).insert(
        key.clone(),
        PendingTool {
            generation: 2,
            sender,
            tool_name: "write_file".to_string(),
            project_id: None,
        },
    );

    drop_pending_tools(&state, "same", Some(1));
    assert!(lock_or_recover(&state.pending_tools).contains_key(&key));

    drop_pending_tools(&state, "same", Some(2));
    assert!(!lock_or_recover(&state.pending_tools).contains_key(&key));
}

#[tokio::test]
async fn non_native_tools_fall_through_to_the_webview_runner() {
    assert!(
        native_agent_tool("some-project", "write_file", "{}")
            .await
            .is_none(),
        "mutating tools must keep using the webview path"
    );
    assert!(native_agent_tool("some-project", "compile", "{}")
        .await
        .is_none());
}

#[tokio::test]
async fn a_failing_native_tool_answers_natively_instead_of_falling_through() {
    let output = native_agent_tool("../not-a-project", "read_file", "{\"path\":\"main.tex\"}")
        .await
        .expect("read_file is native and must answer natively even on failure");
    assert!(output.output.contains("error"), "got: {}", output.output);
}

#[tokio::test]
async fn malformed_native_arguments_become_a_tool_error_not_a_fallthrough() {
    let output = native_agent_tool("../not-a-project", "read_file", "not json")
        .await
        .expect("native tools must not fall through on bad arguments");
    assert!(output.output.contains("error"));
}

#[test]
fn native_dispatch_requires_the_pinned_project_to_still_be_active() {
    assert!(native_dispatch_allowed("proj-a", Some("proj-a")));
    assert!(
        !native_dispatch_allowed("proj-a", Some("proj-b")),
        "a run surviving a project switch must not read the old project natively"
    );
    assert!(
        !native_dispatch_allowed("proj-a", None),
        "no active project (home screen) refuses native dispatch"
    );
}

#[allow(clippy::await_holding_lock)] // env-lock fixture, same as the project tests
#[tokio::test]
async fn native_read_file_answers_with_project_content() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let root = std::env::temp_dir().join(format!("oleafly-native-read-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", &root);
    let project_id = crate::project::create_project("Native Read".into()).unwrap();

    let output = native_agent_tool(&project_id, "read_file", "{\"path\":\"main.tex\"}")
        .await
        .expect("read_file is native");
    assert!(
        output.output.contains("documentclass"),
        "expected the template main.tex content, got: {}",
        output.output
    );

    let validated = crate::commands::ValidatedCompileFingerprint::from_record(
        "the log".into(),
        crate::compile_fingerprint::CompileFingerprint {
            version: crate::compile_fingerprint::FINGERPRINT_VERSION,
            main_document: "main.tex".into(),
            engine_id: "latex".into(),
            output_id: "pdf-v1:1:aa".into(),
            output_revision: 3,
            compiled_at_ms: 9,
            sources: Default::default(),
        },
    );
    assert_eq!(validated.log, "the log");
    assert_eq!(validated.output_revision, 3);

    std::env::remove_var("OLEAFLY_DATA_DIR");
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn native_tool_output_is_the_payload_not_the_mcp_envelope() {
    let envelope = serde_json::json!({
        "content": [{ "type": "text", "text": "{\"files\":[{\"path\":\"main.tex\"}]}" }]
    });
    assert_eq!(
        unwrap_mcp_text(&envelope),
        "{\"files\":[{\"path\":\"main.tex\"}]}"
    );

    let multi = serde_json::json!({
        "content": [
            { "type": "text", "text": "first" },
            { "type": "image", "data": "AAAB" },
            { "type": "text", "text": "second" }
        ]
    });
    assert_eq!(unwrap_mcp_text(&multi), "first\nsecond");
}

#[test]
fn a_result_that_is_not_an_envelope_passes_through_verbatim() {
    let plain = serde_json::json!({ "error": "not found" });
    assert_eq!(unwrap_mcp_text(&plain), plain.to_string());

    let empty_content = serde_json::json!({ "content": [] });
    assert_eq!(unwrap_mcp_text(&empty_content), empty_content.to_string());
}

#[test]
fn tool_risk_mirrors_the_shell_approval_table() {
    // Read class: runs unprompted, may run concurrently.
    for tool in [
        "read_file",
        "list_files",
        "search_project",
        "compile",
        "spawn_agent",
        "wait_agent",
        "close_agent",
    ] {
        assert_eq!(tool_risk(tool), oleafly_agent::ToolRisk::Read, "{tool}");
    }
    // Network class: consent rides on connector configuration.
    for tool in ["literature_search", "verify_citation"] {
        assert_eq!(tool_risk(tool), oleafly_agent::ToolRisk::Network, "{tool}");
    }
    // Shell and write classes confirm.
    assert_eq!(tool_risk("run_command"), oleafly_agent::ToolRisk::Shell);
    for tool in ["write_file", "delete_file", "a_brand_new_tool"] {
        assert_eq!(tool_risk(tool), oleafly_agent::ToolRisk::Write, "{tool}");
    }
}

#[test]
fn the_pipeline_marks_read_tools_parallel_and_everything_else_exclusive() {
    let pipeline = tool_pipeline();
    assert_eq!(
        pipeline.registry.parallel_policy("read_file"),
        oleafly_agent::ParallelPolicy::Parallel
    );
    assert_eq!(
        pipeline.registry.parallel_policy("write_file"),
        oleafly_agent::ParallelPolicy::Exclusive
    );
    assert_eq!(
        pipeline.registry.parallel_policy("unknown_tool"),
        oleafly_agent::ParallelPolicy::Exclusive
    );
}

#[tokio::test]
async fn unadvertised_tools_are_rejected_before_native_or_subagent_dispatch() {
    let calls = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let calls_for_runner = calls.clone();
    let inner: oleafly_agent::ToolRunner = std::sync::Arc::new(move |_| {
        let calls = calls_for_runner.clone();
        Box::pin(async move {
            calls.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            oleafly_agent::ToolOutput::text("executed")
        })
    });
    let runner = allowlisted_tool_runner(
        std::collections::HashSet::from(["read_file".to_string()]),
        inner,
    );

    let rejected = runner(oleafly_agent::ToolCall {
        id: "call-1".into(),
        name: "compile".into(),
        arguments: "{}".into(),
        ..Default::default()
    })
    .await;
    let rejected: serde_json::Value = serde_json::from_str(&rejected.output).unwrap();
    assert_eq!(rejected["error"], "Unknown tool: compile");
    assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 0);

    let accepted = runner(oleafly_agent::ToolCall {
        id: "call-2".into(),
        name: "read_file".into(),
        arguments: "{}".into(),
        ..Default::default()
    })
    .await;
    assert_eq!(accepted.output, "executed");
    assert_eq!(calls.load(std::sync::atomic::Ordering::Relaxed), 1);
}

#[test]
fn the_classifier_skips_without_a_project_and_denies_from_decisions() {
    use oleafly_agent::tools::orchestrator::ApprovalRequirement;
    let call = oleafly_agent::ToolCall {
        id: "c1".into(),
        name: "write_file".into(),
        arguments: "{}".into(),
        ..Default::default()
    };
    // No project pinned: falls back to the risk table (write asks).
    let unpinned = approval_classifier(None);
    assert_eq!(unpinned(&call), ApprovalRequirement::NeedsApproval);

    // Read-class without a project skips.
    let read_call = oleafly_agent::ToolCall {
        name: "read_file".into(),
        ..call.clone()
    };
    assert_eq!(unpinned(&read_call), ApprovalRequirement::Skip);

    // A nonexistent project id yields no decisions, so the risk table
    // governs rather than a blanket deny.
    let pinned = approval_classifier(Some("no-such-project".into()));
    assert_eq!(pinned(&call), ApprovalRequirement::NeedsApproval);
}

#[tokio::test]
async fn steering_requires_user_content_and_an_active_run() {
    let state = crate::agent::AgentState::default();
    let error = crate::agent::steer_run(
        &state,
        "no-such-run",
        oleafly_agent::Message::user("redirect"),
    )
    .await
    .unwrap_err();
    assert!(error.contains("no active run"));
    let error = crate::agent::steer_run(&state, "any", oleafly_agent::Message::user("   "))
        .await
        .unwrap_err();
    assert!(error.contains("must contain text or an image"));
    let error = crate::agent::steer_run(
        &state,
        "any",
        oleafly_agent::Message {
            role: oleafly_agent::Role::Assistant,
            content: vec![oleafly_agent::ContentPart::text("redirect")],
        },
    )
    .await
    .unwrap_err();
    assert!(error.contains("must be a user message"));
}

#[tokio::test]
async fn steering_is_acknowledged_only_after_the_run_receives_it() {
    let state = crate::agent::AgentState::default();
    let (handle, receiver) = oleafly_agent::SteerHandle::channel();
    crate::agent::register_steer_for_test(&state, "run-1", handle);
    drop(receiver);
    let error = crate::agent::steer_run(
        &state,
        "run-1",
        oleafly_agent::Message::user("redirect now"),
    )
    .await
    .unwrap_err();
    assert!(error.contains("stopped before receiving"));

    let token = oleafly_agent::CancellationToken::new();
    let child = token.child();
    crate::agent::register_token_for_test(&state, "run-1", token);
    crate::agent::cancel_run(&state, "run-1");
    assert!(child.is_cancelled());
    let error = crate::agent::steer_run(&state, "run-1", oleafly_agent::Message::user("again"))
        .await
        .unwrap_err();
    assert!(error.contains("no active run"));
}

#[test]
fn initiating_user_text_uses_the_last_user_message() {
    let request = oleafly_agent::CompletionRequest {
        messages: vec![
            oleafly_agent::Message::user("older prompt"),
            oleafly_agent::Message {
                role: oleafly_agent::Role::Assistant,
                content: vec![oleafly_agent::ContentPart::text("older answer")],
            },
            oleafly_agent::Message {
                role: oleafly_agent::Role::User,
                content: vec![
                    oleafly_agent::ContentPart::text("current prompt"),
                    oleafly_agent::ContentPart::Image {
                        image: "data:image/png;base64,AA".into(),
                    },
                ],
            },
        ],
        ..Default::default()
    };

    assert_eq!(
        crate::agent::initiating_user_text(&request),
        "current prompt"
    );
}

#[test]
fn initiating_user_message_survives_rollout_persistence_and_thread_search() {
    let root = tempfile::tempdir().unwrap();
    let request = oleafly_agent::CompletionRequest {
        messages: vec![oleafly_agent::Message::user(
            "cuttlefishprompt repair the citation",
        )],
        ..Default::default()
    };
    let mut recorder = crate::agent::turn_recorder_for_request(
        "turn-search".into(),
        Some("client-search".into()),
        &request,
    );
    recorder.record(&oleafly_agent::AgentEvent::TextDelta {
        text: "I repaired it.".into(),
    });
    recorder.finish(false);
    crate::rollout::append_turn(root.path(), "thread-search", &recorder.into_record()).unwrap();
    let turns = crate::rollout::read_turns(root.path(), "thread-search").unwrap();
    crate::library_db::resync_thread(root.path(), "thread-search", "project-search", &turns)
        .unwrap();

    let hits = crate::library_db::search_threads(root.path(), "cuttlefishprompt", 10).unwrap();

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].thread_id, "thread-search");
}

#[test]
fn dropping_run_resources_cleans_every_registry() {
    let state = crate::agent::AgentState::default();
    let (handle, _receiver) = oleafly_agent::SteerHandle::channel();
    let token = oleafly_agent::CancellationToken::new();
    let child = token.child();
    let manager = std::sync::Arc::new(crate::agent::SubagentManager::default());
    crate::agent::register_run_resources(
        &state,
        "run-1",
        7,
        handle,
        token,
        manager,
        Some("project-1".into()),
        std::collections::HashSet::from(["tool-1".into()]),
    );

    drop(crate::agent::RunResourcesGuard::new(&state, "run-1", 7));

    assert!(child.is_cancelled());
    assert!(crate::agent::subagents_stop(&state, "run-1").is_err());
    assert!(lock_or_recover(&state.steer_senders).get("run-1").is_none());
    assert!(lock_or_recover(&state.run_tokens).get("run-1").is_none());
    assert!(lock_or_recover(&state.run_projects).get("run-1").is_none());
    assert!(lock_or_recover(&state.run_tools).get("run-1").is_none());
}

#[test]
fn stale_run_cleanup_preserves_replacement_resources() {
    let state = crate::agent::AgentState::default();
    let (first_handle, _first_receiver) = oleafly_agent::SteerHandle::channel();
    let (second_handle, _second_receiver) = oleafly_agent::SteerHandle::channel();
    crate::agent::register_run_resources(
        &state,
        "same",
        1,
        first_handle,
        oleafly_agent::CancellationToken::new(),
        std::sync::Arc::new(crate::agent::SubagentManager::default()),
        Some("old-project".into()),
        std::collections::HashSet::from(["old-tool".into()]),
    );
    let replacement = oleafly_agent::CancellationToken::new();
    let replacement_child = replacement.child();
    crate::agent::register_run_resources(
        &state,
        "same",
        2,
        second_handle,
        replacement,
        std::sync::Arc::new(crate::agent::SubagentManager::default()),
        Some("new-project".into()),
        std::collections::HashSet::from(["new-tool".into()]),
    );

    drop(crate::agent::RunResourcesGuard::new(&state, "same", 1));

    assert!(!replacement_child.is_cancelled());
    assert!(crate::agent::subagents_stop(&state, "same").is_ok());
    assert_eq!(
        lock_or_recover(&state.run_projects)
            .get("same")
            .and_then(|project| project.value.as_deref()),
        Some("new-project")
    );
    assert!(lock_or_recover(&state.run_tools)
        .get("same")
        .is_some_and(|tools| tools.value.contains("new-tool")));
}

#[test]
fn run_project_ownership_requires_the_active_generation_and_project() {
    let state = crate::agent::AgentState::default();
    let generation = crate::agent::register_active_request_for_test(&state, "run-owned");
    crate::agent::register_run_project_for_test(&state, "run-owned", generation, "project-1");
    crate::agent::register_run_tools_for_test(
        &state,
        "run-owned",
        generation,
        ["tool-1".to_string()],
    );

    assert!(crate::agent::request_owns_project(
        &state,
        "run-owned",
        "project-1"
    ));
    assert!(!crate::agent::request_owns_project(
        &state,
        "run-owned",
        "project-2"
    ));
    assert!(crate::agent::request_allows_tool(
        &state,
        "run-owned",
        "project-1",
        "tool-1"
    ));
    assert!(!crate::agent::request_allows_tool(
        &state,
        "run-owned",
        "project-1",
        "tool-2"
    ));

    crate::agent::finish_active_request_for_test(&state, "run-owned", generation);

    assert!(!crate::agent::request_owns_project(
        &state,
        "run-owned",
        "project-1"
    ));
    assert!(!crate::agent::request_allows_tool(
        &state,
        "run-owned",
        "project-1",
        "tool-1"
    ));
}

#[tokio::test]
async fn stopping_subagents_targets_the_registered_run_only() {
    let state = crate::agent::AgentState::default();
    let error = crate::agent::subagents_stop(&state, "no-such-run").unwrap_err();
    assert!(error.contains("no active run"));

    let manager = std::sync::Arc::new(crate::agent::SubagentManager::default());
    crate::agent::register_manager_for_test(&state, "run-1", manager);
    // No children yet: zero interrupted, no error.
    assert_eq!(crate::agent::subagents_stop(&state, "run-1").unwrap(), 0);
}
