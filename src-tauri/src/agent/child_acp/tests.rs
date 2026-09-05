use super::completed_turn_output;
use crate::acp::{
    tests::{fixture_definition, fixture_temp},
    AcpRuntime, StartSession,
};
use std::sync::Arc;

async fn session() -> (tempfile::TempDir, Arc<AcpRuntime>, String) {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let snapshot = runtime
        .start(StartSession {
            project_id: "delegation-fixture".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("delegation-test".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    (temp, runtime, snapshot.session.id)
}

#[tokio::test]
async fn delegated_turns_return_only_the_new_answer_after_reconnect() {
    let (_temp, runtime, id) = session().await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "First question".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        "Fixture answer: First question"
    );
    runtime.close(&id).await.unwrap();
    runtime
        .reconnect(&id, Some("delegation-test".into()))
        .await
        .unwrap();
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "Follow-up question".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        "Fixture answer: Follow-up question"
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn delegated_output_reads_every_event_page_before_reporting_success() {
    let (_temp, runtime, id) = session().await;
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    runtime
        .prompt(&id, "paged-answer".into(), Vec::new())
        .await
        .unwrap();
    let expected = (0..520)
        .map(|index| format!("{index}|"))
        .collect::<String>();
    assert_eq!(
        completed_turn_output(&runtime, &id, before).unwrap(),
        expected
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn delegated_partial_answers_are_retained_without_reporting_completion() {
    let (_temp, runtime, id) = session().await;
    for stop in ["max_tokens", "max_turn_requests", "refusal", "cancelled"] {
        let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
        runtime
            .prompt(&id, format!("stop:{stop}"), Vec::new())
            .await
            .unwrap();
        assert!(completed_turn_output(&runtime, &id, before)
            .unwrap_err()
            .contains(stop));
        let events = runtime.events(&id, before, 500).unwrap().events;
        assert!(events
            .iter()
            .any(|event| event.kind == "agent_message_chunk"
                && event.data["content"]["text"] == "Partial saved answer"));
    }
    let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
    assert!(completed_turn_output(&runtime, &id, before)
        .unwrap_err()
        .contains("no completion event"));
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn missing_or_empty_completion_reason_fails_without_losing_partial_output() {
    for prompt in ["missing-stop", "stop:"] {
        let (_temp, runtime, id) = session().await;
        let before = runtime.snapshot(&id).await.unwrap().session.last_sequence;
        assert!(runtime
            .prompt(&id, prompt.into(), Vec::new())
            .await
            .is_err());
        assert_eq!(
            runtime.snapshot(&id).await.unwrap().session.status,
            crate::acp::SessionStatus::Failed
        );
        assert!(completed_turn_output(&runtime, &id, before).is_err());
        let events = runtime.events(&id, before, 500).unwrap().events;
        assert!(events
            .iter()
            .any(|event| event.kind == "agent_message_chunk"
                && super::event_text(&event.data) == Some("Partial saved answer")));
        runtime.close(&id).await.unwrap();
    }
}
