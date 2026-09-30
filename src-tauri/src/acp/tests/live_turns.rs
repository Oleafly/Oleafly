//! Skill folder reads, oversized tool updates and a turn that is still
//! finishing when its agent disconnects (#84 review).

use super::{fixture_definition, fixture_temp};
use crate::acp::{
    protocol::{self, Frame},
    review::ReviewHooks,
    runtime::AcpRuntime,
    skill_block::PromptSkill,
    types::*,
};
use crate::agent_turns::{TurnBegin, TurnChange, TurnChangeKind, TurnChanges};
use serde_json::{json, Value};
use std::{path::Path, sync::Arc, time::Duration};

struct Harness {
    temp: tempfile::TempDir,
    runtime: Arc<AcpRuntime>,
    id: String,
}

impl Harness {
    fn events(&self) -> Vec<AcpEvent> {
        self.runtime.events_all(&self.id).unwrap()
    }
}

async fn start(review: ReviewHooks) -> Harness {
    let temp = fixture_temp();
    let project = temp.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let runtime = AcpRuntime::with_review_hooks(temp.path().join("acp"), review).unwrap();
    runtime
        .register(&serde_json::to_string(&fixture_definition(Vec::new(), temp.path())).unwrap())
        .unwrap();
    let session = runtime
        .start(StartSession {
            project_id: "test-project".into(),
            project_path: project,
            agent_id: "fixture-agent".into(),
            owner: Some("fixture-window".into()),
            ..StartSession::default()
        })
        .await
        .unwrap();
    Harness {
        temp,
        runtime,
        id: session.session.id,
    }
}

// ---- skill folder reads ------------------------------------------------------

fn skill(folder: &Path) -> PromptSkill {
    PromptSkill {
        id: "claim-audit".into(),
        name: "Claim audit".into(),
        block: format!(
            "Selected skill: Claim audit\nSkill folder: {}\n",
            folder.display()
        ),
        folder: Some(folder.to_path_buf()),
    }
}

/// Sends one turn whose agent asks to use `path` with `kind`, and returns the
/// outcome the agent was given.
async fn ask(
    harness: &Harness,
    skill: Option<PromptSkill>,
    kind: Option<&str>,
    path: &Path,
) -> String {
    let before = harness.events().len();
    let request = json!({"kind": kind, "path": path});
    harness
        .runtime
        .prompt_with_skill(
            &harness.id,
            format!("ask-permission:{request}"),
            Vec::new(),
            skill,
        )
        .await
        .unwrap();
    let events = harness.events();
    events[before..]
        .iter()
        .filter(|event| event.kind == "agent_message_chunk")
        .filter_map(|event| event.data["content"]["text"].as_str())
        .find_map(|text| text.strip_prefix("Permission outcome: "))
        .unwrap_or("no answer")
        .to_owned()
}

#[tokio::test]
async fn a_skill_turn_may_read_the_attached_skill_folder_and_nothing_else() {
    let harness = start(ReviewHooks::inert()).await;
    let folder = harness.temp.path().join("skills").join("claim-audit");
    std::fs::create_dir_all(folder.join("references")).unwrap();
    std::fs::write(folder.join("references").join("sources.md"), "# Sources\n").unwrap();
    let elsewhere = harness.temp.path().join("elsewhere");
    std::fs::create_dir_all(&elsewhere).unwrap();
    std::fs::write(elsewhere.join("notes.md"), "private\n").unwrap();
    let reference = folder.join("references").join("sources.md");

    assert_eq!(
        ask(&harness, Some(skill(&folder)), Some("read"), &reference).await,
        "selected",
        "a read of the attached skill's own file is allowed"
    );
    let resolved = harness
        .events()
        .into_iter()
        .rev()
        .find(|event| event.kind == "permission_resolved")
        .unwrap();
    assert_eq!(resolved.data["optionId"], "yes");
    assert_eq!(
        ask(
            &harness,
            Some(skill(&folder)),
            Some("read"),
            &reference.canonicalize().unwrap()
        )
        .await,
        "selected",
        "the folder's canonical spelling leads to the same files"
    );
    assert_eq!(
        ask(&harness, Some(skill(&folder)), Some("search"), &folder).await,
        "selected",
        "searching the skill folder is read-only too"
    );
    assert_eq!(
        ask(&harness, Some(skill(&folder)), Some("edit"), &reference).await,
        "cancelled",
        "the skill folder is never written"
    );
    assert_eq!(
        ask(&harness, Some(skill(&folder)), None, &reference).await,
        "cancelled",
        "a request that does not say it only reads is refused"
    );
    assert_eq!(
        ask(
            &harness,
            Some(skill(&folder)),
            Some("read"),
            &elsewhere.join("notes.md")
        )
        .await,
        "cancelled",
        "other folders outside the project stay closed"
    );
    assert_eq!(
        ask(
            &harness,
            Some(skill(&folder)),
            Some("read"),
            &folder
                .join("..")
                .join("..")
                .join("elsewhere")
                .join("notes.md")
        )
        .await,
        "cancelled"
    );
    assert_eq!(
        ask(&harness, None, Some("read"), &reference).await,
        "cancelled",
        "without an attached skill its folder is outside the project like any other"
    );
    let other_skill = harness.temp.path().join("skills").join("other-skill");
    std::fs::create_dir_all(&other_skill).unwrap();
    std::fs::write(other_skill.join("SKILL.md"), "other\n").unwrap();
    assert_eq!(
        ask(
            &harness,
            Some(skill(&folder)),
            Some("read"),
            &other_skill.join("SKILL.md")
        )
        .await,
        "cancelled",
        "only the skill attached to this turn is readable"
    );
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&elsewhere, folder.join("escape")).unwrap();
        assert_eq!(
            ask(
                &harness,
                Some(skill(&folder)),
                Some("read"),
                &folder.join("escape").join("notes.md")
            )
            .await,
            "cancelled",
            "a link inside the skill folder cannot lead out of it"
        );
    }
    assert_eq!(
        ask(&harness, None, Some("read"), &reference).await,
        "cancelled",
        "the folder is forgotten when the skill turn ends"
    );
    harness.runtime.close(&harness.id).await.unwrap();
}

// ---- oversized tool updates --------------------------------------------------

#[tokio::test]
async fn an_oversized_update_still_completes_its_tool_call() {
    let harness = start(ReviewHooks::inert()).await;
    let finished = harness
        .runtime
        .prompt(&harness.id, "huge-edit".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(finished.session.status, SessionStatus::Ready);
    let events = harness.events();
    let update = events
        .iter()
        .position(|event| {
            event.kind == "tool_call_update" && event.data["toolCallId"] == "edit-big"
        })
        .expect("the tool call keeps its identity");
    assert_eq!(events[update].data["status"], "completed");
    assert_eq!(events[update].data["truncated"], true);
    assert!(events[update].data.get("content").is_none());
    let note = &events[update + 1];
    assert_eq!(note.kind, "diagnostics");
    assert!(note.data["droppedUpdate"]["bytes"].as_u64().unwrap() > 1024 * 1024);
    assert!(events
        .iter()
        .any(|event| event.data["content"]["text"] == "Edited the bibliography."));
    harness.runtime.close(&harness.id).await.unwrap();
}

fn line(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).unwrap();
    bytes.push(b'\n');
    bytes
}

async fn one_frame(value: &Value) -> Frame {
    let bytes = line(value);
    let mut reader = tokio::io::BufReader::new(&bytes[..]);
    protocol::read_agent_frame(&mut reader)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn an_oversized_tool_update_keeps_only_its_identity() {
    let big = "d".repeat(2 * 1024 * 1024);
    let frame = one_frame(&json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native","update":{"sessionUpdate":"tool_call_update","toolCallId":"edit-1","status":"completed","kind":"edit","title":"Edit refs.bib","content":[{"type":"diff","path":"refs.bib","oldText":big,"newText":big}],"rawInput":{"file_path":"refs.bib"}}}})).await;
    let Frame::TruncatedUpdate { bytes, message } = frame else {
        panic!("expected the tool update to keep its identity: {frame:?}");
    };
    assert!(bytes > 4 * 1024 * 1024);
    assert_eq!(
        message,
        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native","update":{"sessionUpdate":"tool_call_update","toolCallId":"edit-1","status":"completed","kind":"edit","title":"Edit refs.bib","truncated":true}}})
    );

    // Fields of an unexpected type are left out rather than failing the read.
    let frame = one_frame(&json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native","update":{"sessionUpdate":"tool_call","toolCallId":"read-1","status":null,"title":{"text":"odd"},"content":[{"type":"content","content":{"type":"text","text":big}}]}}})).await;
    let Frame::TruncatedUpdate { message, .. } = frame else {
        panic!("expected a truncated tool call: {frame:?}");
    };
    assert_eq!(
        message["params"]["update"],
        json!({"sessionUpdate":"tool_call","toolCallId":"read-1","truncated":true})
    );

    // Updates that are not about a tool call, or name none, are only counted.
    for update in [
        json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":big}}),
        json!({"sessionUpdate":"tool_call_update","content":[{"type":"content","content":{"type":"text","text":big}}]}),
    ] {
        let frame = one_frame(&json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native","update":update}})).await;
        assert!(matches!(frame, Frame::DroppedUpdate { .. }), "{frame:?}");
    }
    let frame = one_frame(&json!({"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call_update","toolCallId":"edit-1","text":big}}})).await;
    assert!(matches!(frame, Frame::DroppedUpdate { .. }), "{frame:?}");
}

// ---- a turn still finishing when its agent disconnects -----------------------

fn slow_finish(delay: Duration) -> ReviewHooks {
    ReviewHooks {
        turn_begin: Arc::new(|_, _, _| TurnBegin {
            snapshot_id: Some("snap-1".into()),
            unavailable: None,
        }),
        turn_finish: Arc::new(move |_, snapshot| {
            std::thread::sleep(delay);
            TurnChanges {
                snapshot_id: Some(snapshot.into()),
                files: vec![TurnChange {
                    index: 0,
                    path: "paper.tex".into(),
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
        }),
        head_state: Arc::new(|_| None),
    }
}

async fn wait_for_status(harness: &Harness, status: &str) {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if harness
                .events()
                .iter()
                .any(|event| event.kind == "status" && event.data["status"] == status)
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn reconnecting_waits_for_the_disconnected_turn_to_finish() {
    let harness = start(slow_finish(Duration::from_millis(1500))).await;
    let runtime = harness.runtime.clone();
    let id = harness.id.clone();
    let turn = tokio::spawn(async move { runtime.prompt(&id, "crash".into(), Vec::new()).await });
    wait_for_status(&harness, "disconnected").await;
    let reopened = harness
        .runtime
        .reconnect(&harness.id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(reopened.session.status, SessionStatus::Ready);
    assert!(turn.await.unwrap().is_err());

    let events = harness.events();
    let crashed = events
        .iter()
        .find(|event| event.kind == "user_message")
        .and_then(|event| event.turn_id.clone())
        .unwrap();
    let turn_events: Vec<&str> = events
        .iter()
        .filter(|event| event.turn_id.as_deref() == Some(crashed.as_str()))
        .map(|event| event.kind.as_str())
        .collect();
    assert!(
        turn_events.contains(&"turn_changes"),
        "the Undo card of the crashed turn is kept: {turn_events:?}"
    );
    assert!(turn_events.contains(&"turn_complete"), "{turn_events:?}");
    let sequences: Vec<u64> = events.iter().map(|event| event.sequence).collect();
    assert!(sequences.windows(2).all(|pair| pair[0] + 1 == pair[1]));
    assert_eq!(reopened.session.last_sequence, *sequences.last().unwrap());

    let again = harness
        .runtime
        .prompt(&harness.id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    assert_eq!(again.session.status, SessionStatus::Ready);
    harness.runtime.close(&harness.id).await.unwrap();
}

#[tokio::test]
async fn a_reconnect_after_a_lost_write_continues_after_the_saved_events() {
    let harness = start(ReviewHooks::inert()).await;
    harness
        .runtime
        .prompt(&harness.id, "Hello".into(), Vec::new())
        .await
        .unwrap();
    harness.runtime.close(&harness.id).await.unwrap();
    // A record saved from an older copy of the session lags behind its events.
    let mut record = harness.runtime.record(&harness.id).unwrap();
    let saved = record.last_sequence;
    record.last_sequence = 1;
    crate::acp::store::Store::open(&harness.temp.path().join("acp"))
        .unwrap()
        .save(&record)
        .unwrap();
    let reopened = harness
        .runtime
        .reconnect(&harness.id, Some("fixture-window".into()))
        .await
        .unwrap();
    assert_eq!(reopened.session.status, SessionStatus::Ready);
    assert_eq!(reopened.session.last_sequence, saved + 1);
    harness
        .runtime
        .prompt(&harness.id, "Hello again".into(), Vec::new())
        .await
        .unwrap();
    harness.runtime.close(&harness.id).await.unwrap();
}

// ---- launch roots on mapped network drives -----------------------------------

#[cfg(unix)]
#[test]
fn a_network_root_is_spelled_through_the_drive_that_leads_to_it() {
    use crate::acp::runtime::path_through_alias;
    let temp = tempfile::tempdir().unwrap();
    let share = temp.path().join("server").join("share");
    std::fs::create_dir_all(share.join("thesis").join("chapters")).unwrap();
    let root = share.join("thesis").canonicalize().unwrap();
    let drive = temp.path().join("Z");
    std::os::unix::fs::symlink(&share, &drive).unwrap();
    let deep = temp.path().join("Y");
    std::os::unix::fs::symlink(share.join("thesis"), &deep).unwrap();
    let inside = temp.path().join("X");
    std::os::unix::fs::symlink(share.join("thesis").join("chapters"), &inside).unwrap();
    let alias = |path: &Path| (path.to_path_buf(), path.canonicalize().unwrap());

    assert_eq!(
        path_through_alias(&root, &[alias(&drive)]),
        Some(drive.join("thesis"))
    );
    // The drive closest to the project wins.
    assert_eq!(
        path_through_alias(&root, &[alias(&drive), alias(&deep)]),
        Some(deep.clone())
    );
    // A drive that maps a folder inside the project does not lead to it.
    assert_eq!(path_through_alias(&root, &[alias(&inside)]), None);
    assert_eq!(path_through_alias(&root, &[]), None);
    let unrelated = temp.path().join("unrelated");
    std::fs::create_dir(&unrelated).unwrap();
    assert_eq!(path_through_alias(&root, &[alias(&unrelated)]), None);
}
