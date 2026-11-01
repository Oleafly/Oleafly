use super::super::attachments::{attachment_dir, PromptFile, PromptInput};
use super::super::types::*;
use super::{fixture_definition, fixture_temp, runtime};
use crate::acp::AcpRuntime;
use serde_json::json;
use std::time::Duration;

#[tokio::test]
async fn renaming_locks_the_title_against_agent_updates() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let renamed = runtime
        .rename_session(&id, "  Results chapter  ")
        .await
        .unwrap();
    assert_eq!(renamed.title, "Results chapter");
    assert!(renamed.title_locked);
    assert!(runtime.rename_session(&id, "   ").await.is_err());
    runtime.close(&id).await.unwrap();
    assert!(runtime.record(&id).unwrap().title_locked);
}

#[tokio::test]
async fn deleting_removes_events_attachments_and_asks_the_agent_when_chosen() {
    let (temp, runtime, session) =
        runtime(vec!["--caps-v126".into(), "--record-requests".into()]).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "hello".into(), Vec::new())
        .await
        .unwrap();
    let project = std::path::Path::new(&session.session.project_path).to_path_buf();
    let folder = attachment_dir(&project, &id);
    std::fs::create_dir_all(&folder).unwrap();
    std::fs::write(folder.join("a.pdf"), b"pdf").unwrap();
    runtime.close(&id).await.unwrap();
    let outcome = runtime.delete_session(&id, true).await.unwrap();
    assert!(outcome.agent_deleted, "{:?}", outcome.agent_error);
    assert!(runtime.record(&id).is_err());
    assert!(runtime.events_all(&id).unwrap().is_empty());
    assert!(!folder.exists());
    let requests = std::fs::read_to_string(temp.path().join("requests.jsonl")).unwrap();
    assert!(requests.contains("session/delete"));
}

#[tokio::test]
async fn delete_refuses_a_running_session() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let prompting = runtime.clone();
    let prompt_id = id.clone();
    let turn = tokio::spawn(async move {
        prompting
            .prompt(&prompt_id, "slow-silent".into(), Vec::new())
            .await
    });
    for _ in 0..200 {
        if runtime.snapshot(&id).await.unwrap().session.status == SessionStatus::Running {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(runtime.delete_session(&id, false).await.is_err());
    runtime.cancel(&id).await.unwrap();
    let _ = turn.await;
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn fork_opens_the_new_session_in_a_new_agent_process() {
    let (_temp, runtime, session) = runtime(vec!["--caps-v126".into()]).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "hello".into(), Vec::new())
        .await
        .unwrap();
    let parent_events = runtime.record(&id).unwrap().last_sequence;
    let fork = runtime
        .fork(&id, Some("fixture-window".into()), Vec::new())
        .await
        .unwrap();
    assert_ne!(fork.session.id, id);
    assert!(parent_events > 0);
    assert_eq!(fork.session.fork_sequence, Some(parent_events));
    assert_eq!(runtime.record(&id).unwrap().fork_sequence, None);
    assert_eq!(fork.session.forked_from.as_deref(), Some(id.as_str()));
    assert_eq!(
        fork.session.native_session_id.as_deref(),
        Some("fixture-fork")
    );
    assert!(fork.session.title.ends_with("(fork)"));
    assert_eq!(
        runtime.snapshot(&id).await.unwrap().session.status,
        SessionStatus::Ready
    );
    assert!(runtime
        .events_all(&fork.session.id)
        .unwrap()
        .iter()
        .any(|event| event.kind == "user_message"));
    runtime.close(&fork.session.id).await.unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn updates_for_the_new_session_around_a_forks_reply_do_not_fail_the_parent() {
    let (_temp, runtime, session) =
        runtime(vec!["--caps-v126".into(), "--update-around-fork".into()]).await;
    let id = session.session.id.clone();
    runtime
        .prompt(&id, "hello".into(), Vec::new())
        .await
        .unwrap();
    let fork = runtime
        .fork(&id, Some("fixture-window".into()), Vec::new())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let parent = runtime.snapshot(&id).await.unwrap();
    assert_eq!(parent.session.status, SessionStatus::Ready);
    assert_eq!(parent.session.error, None);
    runtime
        .prompt(&id, "still working".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(fork.session.forked_from.as_deref(), Some(id.as_str()));
    runtime.close(&fork.session.id).await.unwrap();
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn starting_sessions_count_toward_the_limit_and_free_their_place() {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    let mut places = Vec::new();
    for index in 0..8 {
        places.push(
            runtime
                .reserve_slot(&format!("starting-{index}"), None, None)
                .await
                .expect("a place is free"),
        );
    }
    let Err(error) = runtime.reserve_slot("starting-8", None, None).await else {
        panic!("the ninth start is refused");
    };
    assert!(
        crate::app_error::english_error(&error).starts_with("Eight ACP sessions"),
        "{error}"
    );
    assert!(runtime
        .reserve_slot("starting-0", None, None)
        .await
        .is_err());
    places.pop();
    assert!(runtime.reserve_slot("starting-8", None, None).await.is_ok());
}

#[tokio::test]
async fn importing_lists_only_this_project_s_sessions_and_marks_known_ones() {
    let library = crate::collab::testing::TempLibrary::new();
    library.project("import-project", &[("main.tex", "x")]);
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec!["--caps-v126".into(), "--fixture-any-cwd".into()],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    let page = runtime
        .agent_sessions("import-project", "fixture-agent", None)
        .await
        .unwrap();
    assert_eq!(page.sessions.len(), 1);
    assert_eq!(page.sessions[0].native_session_id, "agent-one");
    assert_eq!(page.next_cursor.as_deref(), Some("page-2"));
    let imported = runtime
        .import_sessions("import-project", "fixture-agent", vec!["agent-one".into()])
        .await
        .unwrap();
    assert_eq!(imported[0].title, "Chapter one");
    assert_eq!(imported[0].status, SessionStatus::Disconnected);
    let again = runtime
        .agent_sessions("import-project", "fixture-agent", None)
        .await
        .unwrap();
    assert!(again.sessions[0].imported);
    drop(library);
}

#[tokio::test]
async fn project_and_stored_files_reach_the_agent_as_links() {
    let (temp, runtime, session) =
        runtime(vec!["--caps-v126".into(), "--record-prompt".into()]).await;
    let id = session.session.id.clone();
    let project = std::path::Path::new(&session.session.project_path).to_path_buf();
    std::fs::write(project.join("main.tex"), "\\section{Intro}").unwrap();
    runtime
        .prompt_input(
            &id,
            PromptInput {
                text: "Review this".into(),
                files: vec![PromptFile::Project {
                    path: "main.tex".into(),
                }],
                ..PromptInput::default()
            },
            None,
        )
        .await
        .unwrap();
    let prompt: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(temp.path().join("prompt.json")).unwrap())
            .unwrap();
    let kinds: Vec<_> = prompt
        .as_array()
        .unwrap()
        .iter()
        .map(|block| block["type"].clone())
        .collect();
    assert_eq!(
        kinds,
        [json!("text"), json!("resource_link"), json!("resource")]
    );
    assert!(prompt[1]["uri"].as_str().unwrap().ends_with("/main.tex"));
    let user = runtime
        .events_all(&id)
        .unwrap()
        .into_iter()
        .find(|event| event.kind == "user_message")
        .unwrap();
    assert_eq!(user.data["files"][0]["name"], "main.tex");
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn project_paths_outside_the_project_are_refused_in_prompts() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let error = runtime
        .prompt_input(
            &id,
            PromptInput {
                text: "x".into(),
                files: vec![PromptFile::Project {
                    path: "../outside.tex".into(),
                }],
                ..PromptInput::default()
            },
            None,
        )
        .await
        .unwrap_err();
    assert!(error.contains("inside this project"));
    runtime.close(&id).await.unwrap();
}

#[test]
fn events_reach_only_the_owner_window() {
    let windows = vec!["main".to_string(), "project-2".to_string()];
    assert_eq!(
        crate::acp::route_target(Some("main"), &windows),
        crate::acp::Route::Window("main".into())
    );
}

#[test]
fn task_and_child_events_reach_every_window() {
    let windows = vec!["main".to_string()];
    for owner in [Some("research-task:x"), Some("external:u"), None] {
        assert_eq!(
            crate::acp::route_target(owner, &windows),
            crate::acp::Route::AllWindows
        );
    }
}

#[tokio::test]
async fn summaries_are_throttled_but_keep_the_last_state() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    let mut summaries = runtime.subscribe_summaries();
    runtime
        .prompt(&id, "burst:200".into(), Vec::new())
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(400)).await;
    let mut received = Vec::new();
    while let Ok(summary) = summaries.try_recv() {
        received.push(summary);
    }
    assert!(!received.is_empty());
    assert!(received.len() < 20, "{} summaries", received.len());
    let last = received.last().unwrap();
    assert_eq!(last.status, SessionStatus::Ready);
    assert_eq!(
        last.last_sequence,
        runtime.snapshot(&id).await.unwrap().session.last_sequence
    );
    runtime.close(&id).await.unwrap();
}

#[tokio::test]
async fn quitting_closes_all_sessions_within_eight_seconds() {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let mut ids = Vec::new();
    for _ in 0..3 {
        let snapshot = runtime
            .start(StartSession {
                project_id: "test-project".into(),
                project_path: project.clone(),
                agent_id: "fixture-agent".into(),
                owner: Some("fixture-window".into()),
                ..StartSession::default()
            })
            .await
            .unwrap();
        ids.push(snapshot.session.id);
    }
    for id in &ids {
        let prompting = runtime.clone();
        let id = id.clone();
        tokio::spawn(async move {
            let _ = prompting
                .prompt(&id, "slow-silent".into(), Vec::new())
                .await;
        });
    }
    tokio::time::sleep(Duration::from_millis(300)).await;
    let started = std::time::Instant::now();
    runtime.shutdown_all().await;
    assert!(started.elapsed() < Duration::from_secs(11));
}

#[tokio::test]
async fn a_reconnect_that_routes_nothing_clears_the_routed_provider() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime.close(&id).await.unwrap();
    let mut record = runtime.record(&id).unwrap();
    record.routed_provider = Some("anthropic".into());
    runtime.store.save(&record).unwrap();
    let snapshot = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(snapshot.session.routed_provider, None);
    runtime.close(&id).await.unwrap();
    assert_eq!(runtime.record(&id).unwrap().routed_provider, None);
}

#[tokio::test]
async fn a_conversation_made_on_another_machine_is_not_resumed_here() {
    let (_temp, runtime, session) = runtime(Vec::new()).await;
    let id = session.session.id.clone();
    runtime.close(&id).await.unwrap();
    let mut record = runtime.record(&id).unwrap();
    record.remote = Some(RemoteTarget {
        host: "lab".into(),
        folder: "/home/me/thesis".into(),
    });
    runtime.store.save(&record).unwrap();
    let error = runtime
        .reconnect(&id, Some("fixture-window".into()))
        .await
        .unwrap_err();
    assert_eq!(
        crate::app_error::code(&error).as_deref(),
        Some("acp.start.moved_to_local")
    );
    assert!(
        crate::app_error::english_error(&error).contains("another machine"),
        "{error}"
    );
}

fn task_workspace(temp: &tempfile::TempDir) -> (std::path::PathBuf, std::path::PathBuf) {
    let task = temp.path().join("workspaces").join("task-1");
    let workspace = task.join("2");
    std::fs::create_dir_all(&workspace).unwrap();
    let home = task.join("acp-home-1");
    std::fs::create_dir_all(&home).unwrap();
    (workspace, home)
}

fn task_start(workspace: std::path::PathBuf, agent_id: &str) -> StartSession {
    StartSession {
        project_id: "test-project".into(),
        project_path: workspace,
        agent_id: agent_id.into(),
        task_id: Some("task-1".into()),
        owner: Some("research-task:task-1".into()),
        allowed_paths: Some(Vec::new()),
        ..StartSession::default()
    }
}

#[tokio::test]
async fn adopting_a_handoff_checks_that_the_agent_can_run_tasks() {
    let temp = fixture_temp();
    let (workspace, home) = task_workspace(&temp);
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    let error = runtime
        .adopt_task_session(
            &oleafly_research::handoff::AcpHandoff {
                agent_session_id: "agent-session".into(),
                home,
            },
            task_start(workspace, "hermes"),
            Vec::new(),
            None,
        )
        .await
        .unwrap_err();
    assert!(error.contains("gateway"), "{error}");
}

#[tokio::test]
async fn a_handed_back_home_outside_the_tasks_folder_is_refused() {
    let temp = fixture_temp();
    let (workspace, _home) = task_workspace(&temp);
    let elsewhere = temp.path().join("acp-home-9");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::fs::write(elsewhere.join("keep.txt"), "the user's files").unwrap();
    let misnamed = temp
        .path()
        .join("workspaces")
        .join("task-1")
        .join("Documents");
    std::fs::create_dir_all(&misnamed).unwrap();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    for home in [elsewhere.clone(), misnamed] {
        let error = runtime
            .adopt_task_session(
                &oleafly_research::handoff::AcpHandoff {
                    agent_session_id: "agent-session".into(),
                    home,
                },
                task_start(workspace.clone(), "fixture-agent"),
                Vec::new(),
                None,
            )
            .await
            .unwrap_err();
        assert!(error.contains("not in this task's folder"), "{error}");
    }
    assert!(elsewhere.join("keep.txt").is_file());
}

#[test]
fn this_apps_own_agents_are_never_reaped_as_orphans() {
    let me = oleafly_sandbox::process::identity::current();
    let owner = oleafly_acp::orphans::OwnerTag {
        kind: "app".into(),
        identity: me,
    };
    assert!(crate::acp::owner_alive(&owner, me));
}

#[tokio::test]
async fn listing_paging_and_importing_start_the_agent_once() {
    let library = crate::collab::testing::TempLibrary::new();
    library.project("import-project", &[("main.tex", "x")]);
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(
            &serde_json::to_string(&fixture_definition(
                vec![
                    "--caps-v126".into(),
                    "--fixture-any-cwd".into(),
                    "--record-launch-count".into(),
                ],
                temp.path(),
            ))
            .unwrap(),
        )
        .unwrap();
    let first = runtime
        .agent_sessions("import-project", "fixture-agent", None)
        .await
        .unwrap();
    let second = runtime
        .agent_sessions("import-project", "fixture-agent", first.next_cursor)
        .await
        .unwrap();
    assert_eq!(second.sessions[0].native_session_id, "agent-two");
    runtime
        .import_sessions("import-project", "fixture-agent", vec!["agent-one".into()])
        .await
        .unwrap();
    let launches = std::fs::read_to_string(temp.path().join("launches.log")).unwrap();
    assert_eq!(launches.lines().count(), 1);
    runtime.shutdown_all().await;
    drop(library);
}

#[tokio::test]
async fn task_homes_left_by_a_crash_are_removed_at_startup() {
    let temp = fixture_temp();
    let left = temp.path().join("acp/task-temp/abc/.claude");
    std::fs::create_dir_all(&left).unwrap();
    std::fs::write(left.join(".credentials.json"), "{\"refresh\":\"x\"}").unwrap();
    let _runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    assert!(!temp.path().join("acp/task-temp").exists());
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            let stale = std::fs::read_dir(temp.path().join("acp"))
                .unwrap()
                .flatten()
                .any(|entry| entry.file_name().to_string_lossy().starts_with("task-temp"));
            if !stale {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("the old task homes are deleted");
}

#[tokio::test]
async fn changing_one_remembered_choice_keeps_the_others() {
    let temp = fixture_temp();
    let runtime = AcpRuntime::new(temp.path().join("acp")).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    runtime
        .set_agent_preference(
            "fixture-agent",
            "effort",
            json!({"value": "high", "name": "High"}),
        )
        .await
        .unwrap();
    let prefs = runtime
        .set_agent_preference(
            "fixture-agent",
            "mode",
            json!({"value": "plan", "name": "Plan"}),
        )
        .await
        .unwrap();
    assert_eq!(prefs.effort.unwrap().value, "high");
    assert_eq!(prefs.mode.unwrap().value, "plan");
    let cleared = runtime
        .set_agent_preference("fixture-agent", "effort", json!(null))
        .await
        .unwrap();
    assert!(cleared.effort.is_none() && cleared.mode.is_some());
    assert!(runtime
        .set_agent_preference("fixture-agent", "colour", json!("x"))
        .await
        .is_err());
    assert!(runtime
        .set_agent_preference("missing-agent", "mode", json!(null))
        .await
        .is_err());
}
