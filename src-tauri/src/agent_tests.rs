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
    assert_eq!(resolved.model_id, "llama-3.3-70b-versatile");
    assert_eq!(resolved.credential, "gsk-1");
}

#[test]
fn renderer_run_budgets_are_clamped_to_backend_limits() {
    let config = sanitized_run_config(Some(RunConfig {
        max_steps: u32::MAX,
        max_retries: u32::MAX,
        retry_base_ms: u64::MAX,
    }));

    assert_eq!(config.max_steps, MAX_RUN_STEPS);
    assert_eq!(config.max_retries, MAX_RUN_RETRIES);
    assert_eq!(config.retry_base_ms, MAX_RETRY_BASE_MS);
}

#[test]
fn renderer_run_budgets_have_safe_minimums() {
    let config = sanitized_run_config(Some(RunConfig {
        max_steps: 0,
        max_retries: 0,
        retry_base_ms: 0,
    }));

    assert_eq!(config.max_steps, 1);
    assert_eq!(config.max_retries, 0);
    assert_eq!(config.retry_base_ms, MIN_RETRY_BASE_MS);
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
