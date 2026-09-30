//! Turn review, transcript safety, permission diffs, start revision, export
//! and inline skills (#84).

use super::{fixture_definition, fixture_temp};
use crate::acp::{
    protocol::{self, Frame},
    review::{self, ReviewHooks},
    runtime::AcpRuntime,
    skill_block::PromptSkill,
    types::*,
};
use crate::agent_turns::{TurnBegin, TurnChange, TurnChangeKind, TurnChanges, TurnUnavailable};
use serde_json::{json, Value};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::Duration,
};

#[derive(Default)]
struct Calls {
    begins: Mutex<Vec<(String, String)>>,
    finishes: Mutex<Vec<(String, String)>>,
    head_states: Mutex<Vec<PathBuf>>,
}

impl Calls {
    fn begins(&self) -> Vec<(String, String)> {
        self.begins.lock().unwrap().clone()
    }
    fn finishes(&self) -> Vec<(String, String)> {
        self.finishes.lock().unwrap().clone()
    }
    fn head_states(&self) -> Vec<PathBuf> {
        self.head_states.lock().unwrap().clone()
    }
}

fn hooks(
    calls: &Arc<Calls>,
    begin: TurnBegin,
    finish: TurnChanges,
    head: Option<(String, bool)>,
    begin_delay: Duration,
) -> ReviewHooks {
    let (on_begin, on_finish, on_head) = (calls.clone(), calls.clone(), calls.clone());
    ReviewHooks {
        turn_begin: Arc::new(move |project, label, _ticket| {
            std::thread::sleep(begin_delay);
            on_begin
                .begins
                .lock()
                .unwrap()
                .push((project.into(), label.into()));
            begin.clone()
        }),
        turn_finish: Arc::new(move |project, snapshot| {
            on_finish
                .finishes
                .lock()
                .unwrap()
                .push((project.into(), snapshot.into()));
            finish.clone()
        }),
        head_state: Arc::new(move |root| {
            on_head.head_states.lock().unwrap().push(root.to_path_buf());
            head.clone()
        }),
    }
}

fn copied(snapshot: &str) -> TurnBegin {
    TurnBegin {
        snapshot_id: Some(snapshot.into()),
        unavailable: None,
    }
}

fn one_change(snapshot: &str) -> TurnChanges {
    TurnChanges {
        snapshot_id: Some(snapshot.into()),
        files: vec![TurnChange {
            index: 0,
            path: "data/sk-learn-baseline-results.csv".into(),
            change: TurnChangeKind::Modified,
            before_size: Some(10),
            after_size: Some(12),
            added: Some(1),
            removed: Some(1),
            also_edited_here: false,
            build: false,
        }],
        ..TurnChanges::default()
    }
}

struct Harness {
    temp: tempfile::TempDir,
    runtime: Arc<AcpRuntime>,
    session: SessionSnapshot,
}

impl Harness {
    fn project(&self) -> PathBuf {
        self.temp.path().join("project")
    }
    fn events(&self) -> Vec<AcpEvent> {
        self.runtime.events_all(&self.session.session.id).unwrap()
    }
    fn id(&self) -> String {
        self.session.session.id.clone()
    }
}

async fn start(extra: Vec<String>, review: ReviewHooks, options: StartSession) -> Harness {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    if options.project_id == "git-project" {
        std::fs::create_dir(project.join(".git")).unwrap();
    }
    let runtime = AcpRuntime::with_review_hooks(temp.path().join("acp"), review).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(extra, temp.path())).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..options
        })
        .await
        .unwrap();
    Harness {
        temp,
        runtime,
        session,
    }
}

fn interactive() -> StartSession {
    StartSession {
        project_id: "test-project".into(),
        ..StartSession::default()
    }
}

fn kinds(events: &[AcpEvent]) -> Vec<&str> {
    events.iter().map(|event| event.kind.as_str()).collect()
}

// ---- turn_changes ----------------------------------------------------------

#[tokio::test]
async fn changed_files_are_reported_before_the_turn_completes() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        copied("snap-1"),
        one_change("snap-1"),
        None,
        Duration::ZERO,
    );
    let harness = start(Vec::new(), review, interactive()).await;
    harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(
        calls.begins(),
        vec![("test-project".to_owned(), "Fixture agent".to_owned())]
    );
    assert_eq!(
        calls.finishes(),
        vec![("test-project".to_owned(), "snap-1".to_owned())]
    );
    let events = harness.events();
    let order = kinds(&events);
    let changes = order
        .iter()
        .position(|kind| *kind == "turn_changes")
        .unwrap();
    let complete = order
        .iter()
        .position(|kind| *kind == "turn_complete")
        .unwrap();
    assert_eq!(changes + 1, complete);
    let event = &events[changes];
    assert_eq!(event.data["turnId"], json!(event.turn_id));
    assert_eq!(event.data["snapshotId"], "snap-1");
    assert_eq!(event.data["moreFiles"], 0);
    assert_eq!(event.data["unavailable"], Value::Null);
    // Oleafly's own file names are not run through the credential redactor.
    assert_eq!(
        event.data["files"][0]["path"],
        "data/sk-learn-baseline-results.csv"
    );
    assert_eq!(event.data["files"][0]["change"], "modified");
    assert_eq!(event.data["files"][0]["alsoEditedHere"], false);
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn a_turn_that_changed_nothing_adds_no_card() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        copied("snap-1"),
        TurnChanges {
            snapshot_id: Some("snap-1".into()),
            ..TurnChanges::default()
        },
        None,
        Duration::ZERO,
    );
    let harness = start(Vec::new(), review, interactive()).await;
    harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(calls.finishes().len(), 1);
    assert!(!kinds(&harness.events()).contains(&"turn_changes"));
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[test]
fn more_files_alone_still_reports_the_turn() {
    let changes = TurnChanges {
        snapshot_id: Some("snap".into()),
        more_files: 3,
        ..TurnChanges::default()
    };
    assert!(review::worth_reporting(&changes));
    assert!(!review::worth_reporting(&TurnChanges::default()));
}

#[tokio::test]
async fn a_copy_that_could_not_be_taken_reports_why_without_comparing() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        TurnBegin {
            snapshot_id: None,
            unavailable: Some(TurnUnavailable::TooLarge),
        },
        one_change("never"),
        None,
        Duration::ZERO,
    );
    let harness = start(Vec::new(), review, interactive()).await;
    harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert!(calls.finishes().is_empty());
    let events = harness.events();
    let event = events
        .iter()
        .find(|event| event.kind == "turn_changes")
        .unwrap();
    assert_eq!(event.data["unavailable"], "too_large");
    assert_eq!(event.data["files"], json!([]));
    assert_eq!(event.data["snapshotId"], Value::Null);
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn a_failed_turn_still_reports_its_changes() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        copied("snap-1"),
        one_change("snap-1"),
        None,
        Duration::ZERO,
    );
    let harness = start(Vec::new(), review, interactive()).await;
    assert!(harness
        .runtime
        .prompt(&harness.id(), "crash".into(), Vec::new())
        .await
        .is_err());
    assert_eq!(calls.finishes().len(), 1);
    let events = harness.events();
    let order = kinds(&events);
    let changes = order
        .iter()
        .position(|kind| *kind == "turn_changes")
        .unwrap();
    let complete = order
        .iter()
        .position(|kind| *kind == "turn_complete")
        .unwrap();
    assert!(changes < complete);
}

#[tokio::test]
async fn child_sessions_take_no_before_turn_copy() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        copied("snap-1"),
        one_change("snap-1"),
        None,
        Duration::ZERO,
    );
    let harness = start(
        Vec::new(),
        review,
        StartSession {
            project_id: "test-project".into(),
            parent_session_id: Some("parent-session".into()),
            ..StartSession::default()
        },
    )
    .await;
    harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert!(calls.begins().is_empty());
    assert!(calls.finishes().is_empty());
    assert!(!kinds(&harness.events()).contains(&"turn_changes"));
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[test]
fn only_interactive_top_level_sessions_take_a_copy() {
    assert!(review::takes_turn_copy(false, None));
    assert!(!review::takes_turn_copy(true, None));
    assert!(!review::takes_turn_copy(false, Some("parent")));
    assert!(!review::takes_turn_copy(true, Some("parent")));
}

#[tokio::test]
async fn cancelling_while_the_copy_is_taken_never_sends_the_prompt() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        copied("snap-1"),
        TurnChanges::default(),
        None,
        Duration::from_millis(800),
    );
    let harness = start(
        vec!["".into(), "--record-prompt".into()],
        review,
        interactive(),
    )
    .await;
    let runtime = harness.runtime.clone();
    let id = harness.id();
    let turn = tokio::spawn(async move { runtime.prompt(&id, "Hello".into(), Vec::new()).await });
    tokio::time::sleep(Duration::from_millis(200)).await;
    harness.runtime.cancel(&harness.id()).await.unwrap();
    turn.await.unwrap().unwrap();
    assert!(!harness.temp.path().join("prompt.json").exists());
    assert_eq!(calls.finishes().len(), 1);
    let events = harness.events();
    let complete = events
        .iter()
        .rfind(|event| event.kind == "turn_complete")
        .unwrap();
    assert_eq!(complete.data["stopReason"], "cancelled");
    let snapshot = harness.runtime.snapshot(&harness.id()).await.unwrap();
    assert_eq!(snapshot.session.status, SessionStatus::Ready);
    harness.runtime.close(&harness.id()).await.unwrap();
}

/// A begin hook that waits for the test before taking a real copy, and
/// reports what the copy returned once it is done.
struct LateCopy {
    review: ReviewHooks,
    release: std::sync::mpsc::Sender<()>,
    done: std::sync::mpsc::Receiver<TurnBegin>,
}

fn late_copy() -> LateCopy {
    let (release, gate) = std::sync::mpsc::channel::<()>();
    let (report, done) = std::sync::mpsc::channel::<TurnBegin>();
    let gate = Mutex::new(gate);
    let review = ReviewHooks {
        turn_begin: Arc::new(move |project, label, ticket| {
            gate.lock().unwrap().recv().unwrap();
            let begin = crate::agent_turns::begin_for(project, label, ticket);
            report.send(begin.clone()).unwrap();
            begin
        }),
        ..ReviewHooks::inert()
    };
    LateCopy {
        review,
        release,
        done,
    }
}

impl LateCopy {
    /// Lets the copy run to the end and returns what it produced.
    fn finish_late(&self) -> TurnBegin {
        self.release.send(()).unwrap();
        self.done.recv_timeout(Duration::from_secs(60)).unwrap()
    }
}

fn next_turn_overlapped(project: &str, root: &std::path::Path, content: &str) -> bool {
    let next = crate::agent_turns::begin(project, "Next agent");
    std::fs::write(root.join("main.tex"), content).unwrap();
    let changes = crate::agent_turns::finish(project, next.snapshot_id.as_deref().unwrap(), None);
    assert_eq!(changes.files.len(), 1);
    changes.overlapped
}

/// A private data folder for tests that take real before-turn copies.
struct DataDir {
    _data: tempfile::TempDir,
    _env: std::sync::MutexGuard<'static, ()>,
}

impl DataDir {
    fn new() -> Self {
        let env = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        Self {
            _data: data,
            _env: env,
        }
    }
}

impl Drop for DataDir {
    fn drop(&mut self) {
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}

#[tokio::test]
async fn a_copy_that_outlives_the_deadline_never_marks_later_turns_overlapped() {
    let _data = DataDir::new();
    let project = "review-late-copy";
    let root = crate::paths::create_project_dir(project).unwrap();
    std::fs::write(root.join("main.tex"), "one").unwrap();

    // The runtime stops waiting at the deadline.
    let copy = late_copy();
    let began = review::begin_turn_within(
        &copy.review,
        project,
        "Slow agent",
        Duration::from_millis(50),
    )
    .await;
    assert_eq!(began.unavailable, Some(TurnUnavailable::Timeout));
    let late = copy.finish_late();
    assert_eq!(late.snapshot_id, None, "a copy nobody waits for is dropped");
    assert_eq!(late.unavailable, Some(TurnUnavailable::Timeout));
    let overlapped = next_turn_overlapped(project, &root, "two");

    // The turn future is dropped while it waits.
    let copy = late_copy();
    let dropped = tokio::time::timeout(
        Duration::from_millis(50),
        review::begin_turn_within(
            &copy.review,
            project,
            "Slow agent",
            Duration::from_secs(600),
        ),
    )
    .await;
    assert!(dropped.is_err());
    assert_eq!(copy.finish_late().snapshot_id, None);
    let overlapped_after_drop = next_turn_overlapped(project, &root, "three");

    // A copy that finishes in time is still registered as an open turn.
    let copy = late_copy();
    copy.release.send(()).unwrap();
    let began =
        review::begin_turn_within(&copy.review, project, "Agent", Duration::from_secs(60)).await;
    let snapshot = began.snapshot_id.unwrap();
    let other = crate::agent_turns::begin(project, "Other agent");
    let first = crate::agent_turns::finish(project, &snapshot, None);
    crate::agent_turns::finish(project, other.snapshot_id.as_deref().unwrap(), None);
    assert!(!overlapped, "the late copy left its turn open");
    assert!(
        !overlapped_after_drop,
        "the dropped copy left its turn open"
    );
    assert!(first.overlapped, "a live turn still sees another turn");
}

// ---- transcript and frame safety ------------------------------------------

#[tokio::test]
async fn oversized_tool_output_is_cut_and_the_session_stays_alive() {
    let harness = start(Vec::new(), ReviewHooks::inert(), interactive()).await;
    let finished = harness
        .runtime
        .prompt(&harness.id(), "large-output".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(finished.session.status, SessionStatus::Ready);
    let events = harness.events();
    let output = events
        .iter()
        .filter(|event| event.kind == "tool_call_update")
        .find(|event| event.data["content"][1]["type"] == "diff")
        .unwrap();
    assert_eq!(output.data["content"][0]["truncated"], true);
    let diff = &output.data["content"][1];
    assert_eq!(diff["truncated"], true);
    assert_eq!(diff["oldSize"], 150 * 1024);
    assert_eq!(diff["newSize"], 151 * 1024);
    assert_eq!(diff["newText"].as_str().unwrap().len(), 32 * 1024);
    assert!(events
        .iter()
        .all(|event| serde_json::to_vec(&event.data).unwrap().len() <= 256 * 1024));
    let again = harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(again.session.status, SessionStatus::Ready);
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn an_update_over_1_mib_is_dropped_and_the_turn_continues() {
    let harness = start(Vec::new(), ReviewHooks::inert(), interactive()).await;
    let finished = harness
        .runtime
        .prompt(&harness.id(), "huge-update".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(finished.session.status, SessionStatus::Ready);
    let events = harness.events();
    let dropped = events
        .iter()
        .find(|event| event.kind == "diagnostics")
        .unwrap();
    assert!(dropped.data["droppedUpdate"]["bytes"].as_u64().unwrap() > 3 * 1024 * 1024);
    assert!(events
        .iter()
        .any(|event| event.data["content"]["text"] == "After the large update"));
    let complete = events
        .iter()
        .find(|event| event.kind == "turn_complete")
        .unwrap();
    assert_eq!(complete.data["stopReason"], "end_turn");
    harness.runtime.close(&harness.id()).await.unwrap();
}

fn line(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).unwrap();
    bytes.push(b'\n');
    bytes
}

async fn read_all(input: Vec<u8>) -> Vec<Result<Frame, String>> {
    let mut reader = tokio::io::BufReader::new(&input[..]);
    let mut frames = Vec::new();
    loop {
        match protocol::read_agent_frame(&mut reader).await {
            Ok(Some(frame)) => frames.push(Ok(frame)),
            Ok(None) => break,
            Err(error) => {
                frames.push(Err(error.to_string()));
                break;
            }
        }
    }
    frames
}

#[tokio::test]
async fn frames_between_1_and_16_mib_are_dropped_only_for_update_notifications() {
    let big = "u".repeat(2 * 1024 * 1024);
    let update = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"tool_call_update","content":[{"type":"content","content":{"type":"text","text":big}}]}}});
    let small = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s","update":{"sessionUpdate":"agent_message_chunk"}}});
    let mut input = line(&update);
    input.extend(line(&small));
    let frames = read_all(input).await;
    assert_eq!(frames.len(), 2);
    assert!(matches!(&frames[0], Ok(Frame::DroppedUpdate { bytes }) if *bytes > 2 * 1024 * 1024));
    assert!(matches!(&frames[1], Ok(Frame::Message(value)) if value == &small));

    for oversized in [
        json!({"jsonrpc":"2.0","id":1,"result":{"text":big}}),
        json!({"jsonrpc":"2.0","id":2,"method":"session/update","params":{"text":big}}),
        json!({"jsonrpc":"2.0","id":3,"method":"session/request_permission","params":{"text":big}}),
        json!({"jsonrpc":"1.0","method":"session/update","params":{"text":big}}),
    ] {
        let frames = read_all(line(&oversized)).await;
        assert!(
            matches!(frames.as_slice(), [Err(message)] if message.contains("1 MiB")),
            "{:?}",
            oversized.get("id")
        );
    }

    let huge = json!({"jsonrpc":"2.0","method":"session/update","params":{"text":"u".repeat(17 * 1024 * 1024)}});
    let frames = read_all(line(&huge)).await;
    assert!(matches!(frames.as_slice(), [Err(message)] if message.contains("16 MiB")));
}

// ---- permission diffs ------------------------------------------------------

#[tokio::test]
async fn a_permission_request_shows_the_redacted_change_from_its_tool_call() {
    let marker = new_id();
    let harness = start(
        vec!["".into(), "--raw-input-marker".into(), marker.clone()],
        ReviewHooks::inert(),
        interactive(),
    )
    .await;
    let runtime = harness.runtime.clone();
    let id = harness.id();
    let turn = tokio::spawn(async move {
        runtime
            .prompt(&id, "permission-diff".into(), Vec::new())
            .await
    });
    let permission = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let snapshot = harness.runtime.snapshot(&harness.id()).await.unwrap();
            if let Some(permission) = snapshot.permissions.first() {
                break permission.clone();
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert_eq!(permission.kind.as_deref(), Some("edit"));
    assert_eq!(permission.locations, vec!["paper.tex".to_owned()]);
    assert_eq!(permission.diffs.len(), 1);
    let diff = &permission.diffs[0];
    assert_eq!(diff.path, "paper.tex");
    assert_eq!(diff.old_text.as_deref(), Some("Old sentence.\n"));
    let new_text = diff.new_text.as_deref().unwrap();
    assert!(new_text.starts_with("New sentence.\n"));
    assert!(!new_text.contains(&marker));
    assert!(!diff.truncated);
    let stored = harness
        .events()
        .into_iter()
        .find(|event| event.kind == "permission")
        .unwrap();
    assert_eq!(stored.data["diffs"][0]["path"], "paper.tex");
    assert!(!serde_json::to_string(&stored.data)
        .unwrap()
        .contains(&marker));
    harness
        .runtime
        .resolve_permission(&harness.id(), &permission.id, Some("yes".into()))
        .await
        .unwrap();
    turn.await.unwrap().unwrap();
    harness.runtime.close(&harness.id()).await.unwrap();
}

// ---- start revision ---------------------------------------------------------

#[tokio::test]
async fn a_conversation_records_the_revision_its_repository_started_from() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        TurnBegin::default(),
        TurnChanges::default(),
        Some(("0123456789abcdef".into(), true)),
        Duration::ZERO,
    );
    let harness = start(
        Vec::new(),
        review,
        StartSession {
            project_id: "git-project".into(),
            ..StartSession::default()
        },
    )
    .await;
    assert_eq!(
        harness.session.session.start_revision.as_deref(),
        Some("0123456789abcdef")
    );
    assert_eq!(harness.session.session.start_dirty, Some(true));
    let saved = harness.runtime.record(&harness.id()).unwrap();
    assert_eq!(saved.start_revision.as_deref(), Some("0123456789abcdef"));
    assert_eq!(saved.start_dirty, Some(true));
    assert_eq!(
        calls.head_states(),
        vec![harness.project().canonicalize().unwrap()]
    );
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn a_folder_without_git_never_asks_git_for_a_revision() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        TurnBegin::default(),
        TurnChanges::default(),
        Some(("unexpected".into(), false)),
        Duration::ZERO,
    );
    let harness = start(Vec::new(), review, interactive()).await;
    assert!(calls.head_states().is_empty());
    assert_eq!(harness.session.session.start_revision, None);
    assert_eq!(harness.session.session.start_dirty, None);
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn a_repository_without_a_commit_records_no_revision() {
    let calls = Arc::new(Calls::default());
    let review = hooks(
        &calls,
        TurnBegin::default(),
        TurnChanges::default(),
        None,
        Duration::ZERO,
    );
    let harness = start(
        Vec::new(),
        review,
        StartSession {
            project_id: "git-project".into(),
            ..StartSession::default()
        },
    )
    .await;
    assert_eq!(calls.head_states().len(), 1);
    assert_eq!(harness.session.session.start_revision, None);
    assert_eq!(harness.session.session.start_dirty, None);
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[test]
fn records_saved_before_start_revisions_still_load() {
    let json = json!({
        "id": "s", "projectId": "p", "projectPath": "/p", "agentId": "a",
        "agentVersion": null, "nativeSessionId": null, "parentSessionId": null,
        "taskId": null, "title": "t", "status": "ready", "createdAt": 1,
        "updatedAt": 1, "turnId": null, "capabilities": {"loadSession": false,
        "resume": false, "image": false, "audio": false, "embeddedContext": false,
        "additionalDirectories": false, "mcpHttp": false},
        "controls": {"models": [], "modelId": null, "modelConfigId": null},
        "authMethods": [], "error": null, "lastSequence": 0
    });
    let record: SessionRecord = serde_json::from_value(json).unwrap();
    assert_eq!(record.start_revision, None);
    assert_eq!(record.start_dirty, None);
}

// ---- export ------------------------------------------------------------------

#[tokio::test]
async fn export_writes_the_whole_conversation_as_pretty_json() {
    let harness = start(Vec::new(), ReviewHooks::inert(), interactive()).await;
    harness
        .runtime
        .prompt(&harness.id(), "paged-answer".into(), Vec::new())
        .await
        .unwrap();
    let all = harness.events();
    assert!(all.len() > 520);
    assert!(all
        .windows(2)
        .all(|pair| pair[0].sequence < pair[1].sequence));
    let destination = harness.temp.path().join("conversation.json");
    harness
        .runtime
        .export_session(&harness.id(), &destination.to_string_lossy())
        .unwrap();
    let text = std::fs::read_to_string(&destination).unwrap();
    assert!(text.starts_with("{\n  \"session\": {"));
    let exported: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(exported["session"]["id"], json!(harness.id()));
    let events = exported["events"].as_array().unwrap();
    assert_eq!(events.len(), all.len());
    assert_eq!(events[0]["sequence"], all[0].sequence);
    assert_eq!(
        events.last().unwrap()["sequence"],
        all.last().unwrap().sequence
    );
    assert!(harness
        .runtime
        .export_session(&harness.id(), "relative/conversation.json")
        .is_err());
    assert!(harness
        .runtime
        .export_session(
            "missing-session",
            &harness.temp.path().join("missing.json").to_string_lossy()
        )
        .is_err());
    assert!(!harness.temp.path().join("missing.json").exists());
    harness.runtime.close(&harness.id()).await.unwrap();
}

// ---- inline skills -----------------------------------------------------------

#[tokio::test]
async fn a_picked_skill_follows_the_message_as_its_own_text_block() {
    let harness = start(
        vec!["".into(), "--record-prompt".into()],
        ReviewHooks::inert(),
        interactive(),
    )
    .await;
    let skill = PromptSkill {
        id: "claim-audit".into(),
        name: "Claim audit".into(),
        block: "Selected skill: Claim audit\nCheck every claim.".into(),
        folder: None,
    };
    harness
        .runtime
        .prompt_with_skill(
            &harness.id(),
            "Hello".into(),
            Vec::new(),
            Some(skill.clone()),
        )
        .await
        .unwrap();
    let received: Value = serde_json::from_str(
        &std::fs::read_to_string(harness.temp.path().join("prompt.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        received,
        json!([
            {"type": "text", "text": "Hello"},
            {"type": "text", "text": skill.block}
        ])
    );
    let user = harness
        .events()
        .into_iter()
        .find(|event| event.kind == "user_message")
        .unwrap();
    assert_eq!(user.data["text"], "Hello");
    assert_eq!(
        user.data["skill"],
        json!({"id": "claim-audit", "name": "Claim audit"})
    );
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn the_skill_block_counts_toward_the_message_limit() {
    let harness = start(Vec::new(), ReviewHooks::inert(), interactive()).await;
    let skill = PromptSkill {
        id: "huge".into(),
        name: "Huge".into(),
        block: "s".repeat(protocol::MAX_FRAME),
        folder: None,
    };
    let error = harness
        .runtime
        .prompt_with_skill(&harness.id(), "Hello".into(), Vec::new(), Some(skill))
        .await
        .unwrap_err();
    assert!(error.contains("frame limit"));
    assert!(!kinds(&harness.events()).contains(&"user_message"));
    harness.runtime.close(&harness.id()).await.unwrap();
}

#[tokio::test]
async fn messages_without_a_skill_keep_their_shape() {
    let harness = start(
        vec!["".into(), "--record-prompt".into()],
        ReviewHooks::inert(),
        interactive(),
    )
    .await;
    harness
        .runtime
        .prompt(&harness.id(), "Hello".into(), Vec::new())
        .await
        .unwrap();
    let received: Value = serde_json::from_str(
        &std::fs::read_to_string(harness.temp.path().join("prompt.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(received, json!([{"type": "text", "text": "Hello"}]));
    let user = harness
        .events()
        .into_iter()
        .find(|event| event.kind == "user_message")
        .unwrap();
    assert!(user.data.get("skill").is_none());
    harness.runtime.close(&harness.id()).await.unwrap();
}
