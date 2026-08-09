use super::tests::activate_test_renderer;
use super::*;

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
