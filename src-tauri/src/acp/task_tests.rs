use super::{AcpRuntime, StartSession};

#[tokio::test]
async fn confined_acp_fixture_cannot_read_unlinked_files() {
    let temp = tempfile::tempdir().unwrap();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let outside = temp.path().join("unlinked.txt");
    std::fs::write(&outside, "private fixture data").unwrap();
    let definition = super::tests::fixture_definition(vec![
        String::new(),
        outside.to_string_lossy().into_owned(),
    ]);
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&definition).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_id: "fixture-project".into(),
            project_path: project,
            agent_id: definition.id,
            task_id: Some("fixture-task".into()),
            owner: Some("research-task:fixture".into()),
            allowed_paths: Some(vec!["paper.tex".into()]),
            ..StartSession::default()
        })
        .await
        .unwrap();
    let task_temp = temp.path().join("acp/task-temp");
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 1);
    let id = session.session.id;
    runtime
        .prompt(&id, "scope-probe".into(), Vec::new())
        .await
        .unwrap();
    let events = runtime.events(&id, 0, 100).unwrap().events;
    assert!(events
        .iter()
        .any(|event| event.data["content"]["text"] == "outside read denied"));
    runtime.close(&id).await.unwrap();
    assert_eq!(std::fs::read_dir(&task_temp).unwrap().count(), 0);
    assert!(runtime
        .reconnect(&id, Some("research-task:fixture".into()))
        .await
        .is_err());
}
