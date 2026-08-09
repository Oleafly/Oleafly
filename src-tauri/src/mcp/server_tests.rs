use super::*;
use axum::http::HeaderMap;

fn h(pairs: &[(&str, &str)]) -> HeaderMap {
    let mut m = HeaderMap::new();
    for (k, v) in pairs {
        m.insert(
            axum::http::HeaderName::from_bytes(k.as_bytes()).unwrap(),
            v.parse().unwrap(),
        );
    }
    m
}

fn activate_test_renderer(state: &McpState, renderer_session: u64) {
    activate_renderer_lease_at(state, renderer_session, Instant::now());
}

#[test]
fn auth_requires_exact_bearer_token() {
    let t = "aa".repeat(32);
    assert!(authorized(
        &h(&[("authorization", &format!("Bearer {t}"))]),
        &t
    ));
    assert!(!authorized(
        &h(&[("authorization", &format!("Bearer {t}x"))]),
        &t
    ));
    assert!(!authorized(&h(&[("authorization", "Bearer ")]), &t));
    assert!(
        !authorized(&h(&[("authorization", &t)]), &t),
        "missing Bearer prefix"
    );
    assert!(!authorized(&h(&[]), &t), "missing header");
    assert!(
        !authorized(&h(&[("authorization", "Bearer ")]), ""),
        "empty configured token never authorizes"
    );
}

#[test]
fn constant_time_eq_basics() {
    assert!(constant_time_eq(b"abc", b"abc"));
    assert!(!constant_time_eq(b"abc", b"abd"));
    assert!(!constant_time_eq(b"abc", b"ab"));
}

#[test]
fn origin_header_is_rejected() {
    assert!(origin_allowed(&h(&[])));
    assert!(!origin_allowed(&h(&[("origin", "https://evil.example")])));
    assert!(!origin_allowed(&h(&[("origin", "http://127.0.0.1:5323")])));
    assert!(!origin_allowed(&h(&[("origin", "null")])));
}

#[test]
fn host_must_be_loopback() {
    assert!(host_allowed(&h(&[("host", "127.0.0.1:5323")])));
    assert!(host_allowed(&h(&[("host", "localhost:5323")])));
    assert!(host_allowed(&h(&[("host", "LOCALHOST:5323")])));
    assert!(host_allowed(&h(&[("host", "127.0.0.1")])));
    assert!(host_allowed(&h(&[("host", "[::1]:5323")])));
    assert!(host_allowed(&h(&[("host", "[::1]")])));
    assert!(!host_allowed(&h(&[("host", "localhost:not-a-port")])));
    assert!(!host_allowed(&h(&[("host", "localhost:70000")])));
    assert!(!host_allowed(&h(&[("host", "[::1].attacker.example")])));
    assert!(!host_allowed(&h(&[("host", "[::1]:5323:evil")])));
    assert!(!host_allowed(&h(&[(
        "host",
        "rebind.attacker.example:5323"
    )])));
    assert!(!host_allowed(&h(&[])));
}

#[test]
fn unreadable_configuration_disables_every_mutating_tool() {
    assert_eq!(effective_policy(None), ("ask".to_string(), true));
    assert_eq!(
        effective_policy(Some(("trust".to_string(), false))),
        ("trust".to_string(), false)
    );
}

#[test]
fn readiness_waits_for_both_start_and_nonempty_registration_in_either_order() {
    let epoch = 7;

    assert_eq!(publication_candidate(None, true, true, 0), None);
    assert_eq!(
        publication_candidate(Some(epoch), true, true, 0),
        Some(epoch)
    );

    assert_eq!(publication_candidate(Some(epoch), false, true, 0), None);
    assert_eq!(
        publication_candidate(Some(epoch), true, true, 0),
        Some(epoch)
    );

    assert_eq!(publication_candidate(Some(epoch), true, false, 0), None);

    assert_eq!(publication_candidate(Some(epoch), true, true, epoch), None);
}

#[tokio::test]
async fn clearing_renderer_registry_closes_restart_readiness() {
    let state = McpState::default();
    state.registry_initialized.store(true, Ordering::Release);
    state.registry.lock().await.push(ToolMeta {
        name: "test".into(),
        description: "test tool".into(),
        input_schema: json!({ "type": "object" }),
    });

    clear_renderer_registry(&state).await;

    assert!(!state.registry_initialized.load(Ordering::Acquire));
    assert!(state.registry.lock().await.is_empty());
    assert_eq!(publication_candidate(Some(7), false, true, 0), None);
}

#[test]
fn renderer_lease_fails_closed_at_expiry_and_same_session_can_recover() {
    let state = McpState::default();
    let now = Instant::now();
    activate_renderer_lease_at(&state, 41, now);
    assert!(renderer_session_is_fresh_at(
        &state,
        41,
        now + RENDERER_LEASE_TTL - Duration::from_millis(1)
    ));
    assert!(!renderer_session_is_fresh_at(
        &state,
        41,
        now + RENDERER_LEASE_TTL
    ));
    assert!(renew_renderer_lease_at(&state, 40, now).is_err());
    assert_eq!(
        renew_renderer_lease_at(&state, 41, now + RENDERER_LEASE_TTL)
            .expect("the active session may recover after sleep"),
        (true, true)
    );
    assert!(renderer_session_is_fresh_at(
        &state,
        41,
        now + RENDERER_LEASE_TTL
    ));

    activate_renderer_lease_at(&state, 42, now);
    assert!(!renderer_session_is_fresh_at(&state, 41, now));
    assert!(renew_renderer_lease_at(&state, 41, now).is_err());
}

#[test]
fn renderer_expiry_is_revoked_once_before_recovery() {
    let state = McpState::default();
    let now = Instant::now();
    activate_renderer_lease_at(&state, 9, now);
    let expired_at = now + RENDERER_LEASE_TTL;
    assert!(mark_renderer_expiration_revoked_at(&state, 9, expired_at));
    assert!(!mark_renderer_expiration_revoked_at(&state, 9, expired_at));
    assert_eq!(
        renew_renderer_lease_at(&state, 9, expired_at).unwrap(),
        (true, false),
        "a supervisor-drained expiry must not be revoked twice by recovery"
    );
}

#[test]
fn listener_exit_cleanup_is_bound_to_the_listener_incarnation_not_auth_epoch() {
    assert!(serve_exit_is_current(Some(7), 7, true));
    assert!(!serve_exit_is_current(Some(8), 7, true));
    assert!(!serve_exit_is_current(Some(7), 7, false));
}

#[tokio::test]
async fn unexpected_exit_claim_clears_only_the_current_listener() {
    let state = McpState::default();
    let (shutdown, _shutdown_rx) = watch::channel(false);
    *state.shutdown.lock().await = Some(shutdown);
    let (_completed_tx, completed) = oneshot::channel();
    *state.serve_instance.lock().await = Some(ServeInstance { id: 8, completed });

    assert!(!claim_unexpected_serve_exit(&state, 7).await);
    assert!(state.shutdown.lock().await.is_some());
    assert_eq!(
        state
            .serve_instance
            .lock()
            .await
            .as_ref()
            .map(|instance| instance.id),
        Some(8)
    );

    assert!(claim_unexpected_serve_exit(&state, 8).await);
    assert!(state.shutdown.lock().await.is_none());
    assert!(state.serve_instance.lock().await.is_none());
}

#[tokio::test]
async fn listener_completion_is_signalled_before_cleanup_waits_for_lifecycle() {
    let lifecycle = Arc::new(Mutex::new(()));
    let lifecycle_guard = lifecycle.lock().await;
    let cleaned = Arc::new(AtomicBool::new(false));
    let (completed_tx, completed_rx) = oneshot::channel();
    let cleanup_lifecycle = Arc::clone(&lifecycle);
    let cleanup_flag = Arc::clone(&cleaned);
    let monitor = tokio::spawn(async move {
        signal_completion_before_cleanup(completed_tx, || async move {
            let _lifecycle = cleanup_lifecycle.lock().await;
            cleanup_flag.store(true, Ordering::Release);
        })
        .await;
    });

    tokio::time::timeout(Duration::from_secs(1), completed_rx)
        .await
        .expect("completion must not wait for the lifecycle lock")
        .expect("monitor must signal completion");
    assert!(!cleaned.load(Ordering::Acquire));
    drop(lifecycle_guard);
    monitor.await.expect("cleanup task should finish");
    assert!(cleaned.load(Ordering::Acquire));
}

#[test]
fn admission_rejects_an_authentication_snapshot_paused_across_rotation() {
    let authenticated_epoch = 11;
    assert!(admission_is_current(
        authenticated_epoch,
        authenticated_epoch,
        authenticated_epoch
    ));
    assert!(!admission_is_current(
        authenticated_epoch,
        authenticated_epoch + 1,
        authenticated_epoch + 1
    ));
    assert!(!admission_is_current(
        authenticated_epoch,
        authenticated_epoch,
        0
    ));
}

#[test]
fn renderer_revocation_keeps_native_admission_open_only_from_a_consistent_epoch() {
    assert_eq!(advance_published_epoch(8, 8, 9), 9);
    assert_eq!(advance_published_epoch(0, 8, 9), 0);
    assert_eq!(advance_published_epoch(7, 8, 9), 0);
}

#[test]
fn an_applied_native_mutation_is_reported_after_epoch_rotation() {
    assert!(native_completion_is_reportable(false, true, true));
    assert!(!native_completion_is_reportable(false, true, false));
    assert!(!native_completion_is_reportable(false, false, true));
    assert!(native_completion_is_reportable(true, true, false));
}

#[test]
fn authenticated_request_slots_are_bounded() {
    let state = McpState::default();
    let mut permits = (0..MAX_AUTHENTICATED_REQUESTS)
        .map(|_| acquire_request_slot(&state).expect("slot within configured bound"))
        .collect::<Vec<_>>();
    assert!(acquire_request_slot(&state).is_err());
    permits.pop();
    assert!(acquire_request_slot(&state).is_ok());
}

#[tokio::test]
async fn body_collection_enforces_the_limit() {
    let accepted = collect_body_limited(Body::from("four"), 4)
        .await
        .expect("body at the bound should be accepted");
    assert_eq!(&accepted[..], b"four");
    assert_eq!(
        collect_body_limited(Body::from("five!"), 4)
            .await
            .expect_err("oversized body must be rejected"),
        StatusCode::PAYLOAD_TOO_LARGE
    );
}

#[tokio::test]
async fn body_collection_times_out_a_stalled_authenticated_upload() {
    let stream = futures_util::stream::pending::<Result<Bytes, std::io::Error>>();
    let result =
        collect_body_limited_with_timeout(Body::from_stream(stream), 4, Duration::from_millis(1))
            .await;
    assert_eq!(result.unwrap_err(), StatusCode::REQUEST_TIMEOUT);
}

#[test]
fn cleanup_failures_are_appended_to_the_primary_lifecycle_error() {
    assert_eq!(
        combine_cleanup_error(
            "publication failed".into(),
            Err("permission denied".into()),
            "Cleanup failed",
        ),
        "publication failed. Cleanup failed: permission denied"
    );
    assert_eq!(
        combine_cleanup_error("publication failed".into(), Ok(()), "Cleanup failed"),
        "publication failed"
    );
}

#[test]
fn invalid_utf8_is_a_json_parse_error() {
    assert!(serde_json::from_slice::<Value>(&[0xff, 0xfe]).is_err());
}

#[test]
fn forwarded_pending_calls_are_capped_and_cancel_safe() {
    let state = McpState::default();
    state.epoch.store(3, Ordering::Release);
    activate_test_renderer(&state, 30);
    let mut registrations = Vec::new();
    for _ in 0..MAX_PENDING_FORWARD_CALLS {
        registrations.push(
            register_pending(&state, 3, 30, |_| Ok(()), None)
                .expect("registration within pending bound"),
        );
    }
    assert_eq!(lock_pending(&state).len(), MAX_PENDING_FORWARD_CALLS);
    assert!(register_pending(&state, 3, 30, |_| Ok(()), None).is_err());

    registrations.pop();
    assert_eq!(
        lock_pending(&state).len(),
        MAX_PENDING_FORWARD_CALLS - 1,
        "dropping a request must remove its abandoned pending call"
    );
    assert!(register_pending(&state, 2, 30, |_| Ok(()), None).is_err());
    assert!(register_pending(&state, 3, 29, |_| Ok(()), None).is_err());
}

#[test]
fn renderer_results_cannot_cross_session_or_epoch_boundaries() {
    let state = McpState::default();
    state.epoch.store(12, Ordering::Release);
    activate_test_renderer(&state, 120);
    let (mut receiver, registration) =
        register_pending(&state, 12, 120, |_| Ok(()), None).expect("pending call");

    assert!(take_pending_result(&state, registration.call_id, 119).is_none());
    assert_eq!(lock_pending(&state).len(), 1);
    let call = take_pending_result(&state, registration.call_id, 120)
        .expect("matching renderer may answer");
    let _ = call
        .sender
        .send(PendingReply::Result(json!({ "ok": true })));
    assert!(matches!(
        receiver.try_recv(),
        Ok(PendingReply::Result(value)) if value == json!({ "ok": true })
    ));
    drop(registration);
    assert!(lock_pending(&state).is_empty());

    let (_receiver, registration) =
        register_pending(&state, 12, 120, |_| Ok(()), None).expect("second pending call");
    state.epoch.store(13, Ordering::Release);
    assert!(take_pending_result(&state, registration.call_id, 120).is_none());
}

#[test]
fn abandoned_and_timed_out_calls_emit_exact_cancellation_metadata() {
    let state = McpState::default();
    state.epoch.store(6, Ordering::Release);
    activate_test_renderer(&state, 60);
    let cancellations = Arc::new(std::sync::Mutex::new(Vec::new()));

    let disconnected = cancellation_registration(&state, Arc::clone(&cancellations));
    drop(disconnected);

    let mut timed_out = cancellation_registration(&state, Arc::clone(&cancellations));
    timed_out.mark_timed_out();
    drop(timed_out);

    assert_eq!(
        *cancellations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
        vec![
            (0, 6, CANCEL_REASON_CLIENT_DISCONNECTED),
            (1, 6, CANCEL_REASON_TIMEOUT),
        ]
    );
    assert_eq!(
        tool_call_cancelled_payload(1, 6, 60, CANCEL_REASON_TIMEOUT),
        json!({
            "callId": 1,
            "epoch": 6,
            "rendererSession": 60,
            "reason": "timeout"
        })
    );
    assert!(lock_pending(&state).is_empty());
}

type CancellationEvents = Arc<std::sync::Mutex<Vec<(u64, u64, &'static str)>>>;

fn cancellation_registration<'a>(
    state: &'a McpState,
    events: CancellationEvents,
) -> PendingRegistration<'a> {
    let (_, registration) = register_pending(
        state,
        6,
        60,
        |_| Ok(()),
        Some(Box::new(move |call_id, epoch, reason| {
            events
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .push((call_id, epoch, reason));
        })),
    )
    .expect("call registration");
    registration
}

#[test]
fn lifecycle_invalidation_does_not_emit_redundant_per_call_cancellation() {
    let state = McpState::default();
    state.epoch.store(8, Ordering::Release);
    activate_test_renderer(&state, 80);
    let cancellations = Arc::new(std::sync::Mutex::new(0));
    let captured = Arc::clone(&cancellations);
    let (mut receiver, registration) = register_pending(
        &state,
        8,
        80,
        |_| Ok(()),
        Some(Box::new(move |_, _, _| {
            *captured
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner()) += 1;
        })),
    )
    .expect("pending registration");

    invalidate_pending(&state, PendingInterruption::Revoked, |_| {});
    assert!(matches!(receiver.try_recv(), Ok(PendingReply::Revoked)));
    drop(registration);
    assert_eq!(
        *cancellations
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()),
        0
    );
}

#[test]
fn epoch_invalidation_emits_before_waking_pending_calls() {
    use tokio::sync::oneshot::error::TryRecvError;

    let state = McpState::default();
    state.epoch.store(9, Ordering::Release);
    activate_test_renderer(&state, 90);
    let (mut receiver, _registration) =
        register_pending(&state, 9, 90, |_| Ok(()), None).expect("pending registration");
    let (revoked, next) = invalidate_pending(&state, PendingInterruption::Revoked, |event_epoch| {
        assert_eq!(event_epoch, 9);
        assert!(matches!(receiver.try_recv(), Err(TryRecvError::Empty)));
    });
    assert_eq!((revoked, next), (9, 10));
    assert!(matches!(receiver.try_recv(), Ok(PendingReply::Revoked)));
    assert!(lock_pending(&state).is_empty());
}

#[test]
fn stop_invalidation_fails_every_pending_call() {
    let state = McpState::default();
    state.epoch.store(4, Ordering::Release);
    activate_test_renderer(&state, 40);
    let (mut first, _first_registration) =
        register_pending(&state, 4, 40, |_| Ok(()), None).expect("first pending registration");
    let (mut second, _second_registration) =
        register_pending(&state, 4, 40, |_| Ok(()), None).expect("second pending registration");

    invalidate_pending(&state, PendingInterruption::ServerStopped, |_| {});
    assert!(matches!(first.try_recv(), Ok(PendingReply::ServerStopped)));
    assert!(matches!(second.try_recv(), Ok(PendingReply::ServerStopped)));
    assert!(lock_pending(&state).is_empty());
}

#[test]
fn native_activity_names_are_bounded_by_characters() {
    let name = format!("{}é", "a".repeat(MAX_ACTIVITY_TOOL_NAME_CHARS));
    let bounded = bounded_activity_tool_name(&name);
    assert_eq!(bounded.chars().count(), MAX_ACTIVITY_TOOL_NAME_CHARS);
    assert!(!bounded.ends_with('é'));
}

#[test]
fn discovery_cleanup_surfaces_non_file_targets() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("mcp.json");
    std::fs::create_dir(&path).unwrap();
    let error =
        remove_discovery_file_at(&path).expect_err("a directory is not removable as a file");
    assert!(error.contains("failed to remove MCP discovery file"));
    std::fs::remove_dir(path).unwrap();
}

#[cfg(unix)]
#[test]
fn discovery_file_is_owner_only_and_atomically_replaced() {
    use std::os::unix::fs::PermissionsExt as _;

    let temp = tempfile::tempdir().expect("unique test directory");
    let directory = temp.path();
    let path = directory.join("mcp.json");

    write_discovery_file_at(&path, 3210, "first-secret").expect("first publication");
    write_discovery_file_at(&path, 4321, "replacement-secret").expect("atomic replacement");
    let metadata = std::fs::metadata(&path).expect("published file metadata");
    assert_eq!(metadata.permissions().mode() & 0o777, 0o600);
    let document: Value =
        serde_json::from_slice(&std::fs::read(&path).expect("read owner-only discovery document"))
            .expect("valid discovery JSON");
    assert_eq!(document["url"], "http://127.0.0.1:4321/mcp");
    assert_eq!(document["token"], "replacement-secret");
    assert_eq!(
        std::fs::read_dir(directory)
            .expect("list test directory")
            .count(),
        1,
        "successful publication must not leave staging files"
    );

    std::fs::remove_file(&path).expect("remove test discovery file");
    std::fs::remove_dir(directory).expect("remove test directory");
}
