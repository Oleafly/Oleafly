use std::sync::Arc;
use std::time::{Duration, Instant};

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use super::super::tests::{rest_for, until_sent};
use super::{update_of, DocAtVersion, HistoryError, TreeOp};
use crate::client::Http;
use crate::live::rest::{ProjectRest, RestError, SettingsUpdate};
use crate::realtime::events::{DocId, EntityId};
use crate::realtime::tree::NodeKind;
use crate::realtime::ProjectPage;
use crate::session::{Session, SessionHandle};
use crate::test_support::mock_overleaf::{Fault, MockOverleaf, MockProject, MockUser, Privilege};
use crate::test_support::Request;

fn project() -> MockProject {
    MockProject::new("History")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .doc("main.tex", "First draft")
        .doc("refs.bib", "@book{a}")
        .file("figure.png", b"\x89PNG data")
}

fn sent(mock: &MockOverleaf, method: &str, route: &str) -> Vec<Request> {
    mock.requests(&format!("/project/{}{route}", mock.project_id()))
        .into_iter()
        .filter(|request| request.method == method)
        .collect()
}

fn edit(mock: &MockOverleaf, user: &str, path: &str, text: &str) {
    mock.external_edit(&mock.doc_id(path), 0, text);
    mock.record_version(user, path);
}

#[test]
fn an_update_merges_paths_from_its_ops_and_skips_gone_users() {
    let update = update_of(&json!({
        "fromV": 4,
        "toV": 7,
        "meta": {
            "users": [
                { "id": "6af963eac9037022065bb52c", "first_name": "Bob", "last_name": "Editor", "email": "bob@example.test" },
                null,
                { "first_name": "no id" }
            ],
            "start_ts": 1794731315976_u64,
            "end_ts": 1794731319718_u64
        },
        "labels": [
            { "id": "6af9000000000000000000a1", "comment": "older", "version": 7, "user_id": "6af963eac9037022065bb52c", "created_at": "2026-11-15T08:00:00.000Z" },
            { "id": "6af9000000000000000000a2", "comment": "newer", "version": 7, "created_at": "2026-11-15T09:00:00.000Z" },
            { "id": "../bad", "comment": "hostile", "version": 7 }
        ],
        "pathnames": ["main.tex"],
        "project_ops": [
            { "add": { "pathname": "new.tex" }, "atV": 5 },
            { "rename": { "pathname": "old.tex", "newPathname": "sections/old.tex" }, "atV": 6 },
            { "remove": { "pathname": "gone.tex" }, "atV": 6 }
        ]
    }))
    .unwrap();
    assert_eq!((update.from, update.to), (4, 7));
    assert_eq!(update.end_ms - update.start_ms, 3742);
    assert_eq!(
        update
            .users
            .iter()
            .map(|user| user.id.as_str())
            .collect::<Vec<_>>(),
        ["6af963eac9037022065bb52c"]
    );
    assert_eq!(
        update
            .labels
            .iter()
            .map(|label| label.comment.as_str())
            .collect::<Vec<_>>(),
        ["newer", "older"]
    );
    assert_eq!(update.labels[0].user_id, None);
    assert_eq!(
        update.paths,
        [
            "gone.tex",
            "main.tex",
            "new.tex",
            "old.tex",
            "sections/old.tex"
        ]
    );
    assert!(update_of(&json!({ "toV": 3 })).is_none());
}

#[tokio::test]
async fn updates_page_with_before_until_no_next_timestamp() {
    let mock = MockOverleaf::start(project()).await;
    for round in 0..5 {
        edit(&mock, "bob", "main.tex", &format!("{round} "));
    }
    let (rest, session) = rest_for(&mock, "alice").await;
    let first = rest.updates(&session, None, 2).await.unwrap();
    assert_eq!(
        first
            .updates
            .iter()
            .map(|update| update.to)
            .collect::<Vec<_>>(),
        [5, 4]
    );
    assert_eq!(first.updates[0].users[0].first_name.as_deref(), Some("Bob"));
    let before = first.next_before.expect("more pages");
    let second = rest.updates(&session, Some(before), 2).await.unwrap();
    assert_eq!(
        second
            .updates
            .iter()
            .map(|update| update.to)
            .collect::<Vec<_>>(),
        [3, 2]
    );
    let last = rest.updates(&session, second.next_before, 2).await.unwrap();
    assert_eq!(
        last.updates
            .iter()
            .map(|update| update.to)
            .collect::<Vec<_>>(),
        [1]
    );
    assert_eq!(last.next_before, None);
    let asked = sent(&mock, "GET", "/updates");
    assert!(
        asked.iter().any(|request| request
            .path
            .contains(&format!("min_count=2&before={before}"))),
        "{asked:?}"
    );
}

#[tokio::test]
async fn a_version_reads_as_text_binary_or_missing_and_the_tree_diff_names_changes() {
    let mock = MockOverleaf::start(project()).await;
    edit(&mock, "bob", "main.tex", "Second ");
    let (rest, session) = rest_for(&mock, "dave").await;
    assert_eq!(
        rest.doc_at(&session, 0, "main.tex").await.unwrap(),
        DocAtVersion::Text("First draft".into())
    );
    assert_eq!(
        rest.doc_at(&session, 1, "/main.tex").await.unwrap(),
        DocAtVersion::Text("Second First draft".into())
    );
    assert_eq!(
        rest.doc_at(&session, 1, "figure.png").await.unwrap(),
        DocAtVersion::Binary
    );
    assert_eq!(
        rest.doc_at(&session, 1, "nothere.tex").await,
        Err(HistoryError::Missing)
    );
    assert_eq!(
        rest.doc_at(&session, 1, "../main.tex").await,
        Err(HistoryError::Invalid("a path that can't be in a project"))
    );
    let diff = rest.tree_diff(&session, 0, 1).await.unwrap();
    let edited: Vec<&str> = diff
        .iter()
        .filter(|entry| entry.op == Some(TreeOp::Edited))
        .map(|entry| entry.path.as_str())
        .collect();
    assert_eq!(edited, ["main.tex"]);
    assert!(diff
        .iter()
        .any(|entry| entry.path == "refs.bib" && entry.op.is_none()));
}

#[tokio::test]
async fn a_file_missing_from_a_version_takes_one_request_and_a_busy_reply_is_retried() {
    let mock = MockOverleaf::start(project()).await;
    edit(&mock, "bob", "main.tex", "Second ");
    let (rest, session) = rest_for(&mock, "dave").await;
    assert_eq!(
        rest.doc_at(&session, 1, "nothere.tex").await,
        Err(HistoryError::Missing)
    );
    assert_eq!(sent(&mock, "GET", "/diff").len(), 1);
    mock.plan_fault(
        Some("GET"),
        &format!("/project/{}/diff", mock.project_id()),
        Fault::Reply(503, "Service Unavailable".into()),
    );
    assert_eq!(
        rest.doc_at(&session, 1, "main.tex").await.unwrap(),
        DocAtVersion::Text("Second First draft".into())
    );
    assert_eq!(sent(&mock, "GET", "/diff").len(), 3);
}

#[tokio::test]
async fn restricted_link_viewers_get_no_history() {
    let mock = MockOverleaf::start(project()).await;
    let (rest, session) = rest_for(&mock, "erin").await;
    assert_eq!(
        rest.updates(&session, None, 10).await,
        Err(HistoryError::Rest(RestError::NotAllowed))
    );
    let zip = tempfile::NamedTempFile::new().unwrap();
    assert_eq!(
        rest.version_zip(&session, 0, zip.path(), |_, _| {}).await,
        Err(HistoryError::Rest(RestError::NotAllowed))
    );
}

#[tokio::test]
async fn labels_are_added_and_only_their_author_or_the_owner_deletes_them() {
    let mock = MockOverleaf::start(project()).await;
    edit(&mock, "bob", "main.tex", "x");
    let (carol, carol_session) = rest_for(&mock, "carol").await;
    let label = carol
        .add_label(&carol_session, 1, "Submitted")
        .await
        .unwrap();
    assert_eq!((label.version, label.comment.as_str()), (1, "Submitted"));
    assert_eq!(
        label.user_id.as_deref(),
        Some(mock.user("carol").id.as_str())
    );
    assert_eq!(
        carol.add_label(&carol_session, 1, "  ").await,
        Err(HistoryError::Invalid("an empty version name"))
    );
    let (dave, dave_session) = rest_for(&mock, "dave").await;
    assert_eq!(
        dave.add_label(&dave_session, 1, "No").await,
        Err(HistoryError::Rest(RestError::NotAllowed))
    );
    let page = carol.updates(&carol_session, None, 5).await.unwrap();
    assert_eq!(page.updates[0].labels[0].id, label.id);
    assert_eq!(
        carol.labels(&carol_session).await.unwrap(),
        vec![label.clone()]
    );

    let (bob, bob_session) = rest_for(&mock, "bob").await;
    bob.delete_label(&bob_session, &label.id).await.unwrap();
    let kept = bob.updates(&bob_session, None, 5).await.unwrap();
    assert_eq!(
        kept.updates[0].labels.len(),
        1,
        "bob's delete answers 204 but keeps it"
    );
    let (alice, alice_session) = rest_for(&mock, "alice").await;
    alice.delete_label(&alice_session, &label.id).await.unwrap();
    let gone = alice.updates(&alice_session, None, 5).await.unwrap();
    assert!(gone.updates[0].labels.is_empty());
    assert_eq!(
        alice.delete_label(&alice_session, "../x").await,
        Err(HistoryError::Invalid(
            "a label id with unexpected characters"
        ))
    );
}

#[tokio::test]
async fn a_file_restore_replaces_the_doc_with_a_gap_and_answers_after_it() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| {
        config.restore_gap = Duration::from_millis(1500);
        config.ranges_support = true;
    });
    let old = mock.doc_id("main.tex");
    edit(&mock, "bob", "main.tex", "Changed ");
    let mut watcher = mock.peer("dave");
    let (rest, session) = rest_for(&mock, "bob").await;
    let started = Instant::now();
    let restored = rest.revert_file(&session, 0, "main.tex").await.unwrap();
    assert!(started.elapsed() >= Duration::from_millis(1500));
    assert_eq!(restored.kind, NodeKind::Doc);
    assert_ne!(restored.id, EntityId(old.clone()));
    let removed = watcher.take_events("removeEntity");
    assert_eq!(removed.len(), 1);
    assert_eq!(removed[0][0], json!(old));
    assert_eq!(removed[0][1]["kind"], json!("file-restore"));
    let added = watcher.take_events("reciveNewDoc");
    assert_eq!(added[0][1]["_id"], json!(restored.id.0));
    assert_eq!(added[0][2]["kind"], json!("file-restore"));
    assert_eq!(
        watcher.take_events("rootDocUpdated")[0][0],
        json!(restored.id.0)
    );
    assert_eq!(mock.doc_text(&restored.id.0), "First draft");
}

#[tokio::test]
async fn restoring_a_deleted_file_adds_it_and_a_clash_gets_a_new_name() {
    let mock = MockOverleaf::start(project()).await;
    let (rest, session) = rest_for(&mock, "bob").await;
    let copy = rest.restore_file(&session, 0, "main.tex").await.unwrap();
    assert_eq!(copy.kind, NodeKind::Doc);
    assert_eq!(sent(&mock, "POST", "/restore_file").len(), 1);
    assert!(mock
        .entity_id("main (Restored on 23rd Nov 26 9:00:00).tex")
        .is_some());
    let (carol, carol_session) = rest_for(&mock, "carol").await;
    assert_eq!(
        carol.revert_file(&carol_session, 0, "main.tex").await,
        Err(HistoryError::Rest(RestError::NotAllowed))
    );
    assert_eq!(
        rest.restore_file(&session, 0, "nothere.tex").await,
        Err(HistoryError::Missing)
    );
}

#[tokio::test]
async fn a_server_without_ranges_support_refuses_to_revert_and_changes_nothing() {
    let mock = MockOverleaf::start(project()).await;
    let mut watcher = mock.peer("dave");
    let (rest, session) = rest_for(&mock, "alice").await;
    assert_eq!(
        rest.revert_file(&session, 0, "main.tex").await,
        Err(HistoryError::CannotRevert)
    );
    assert_eq!(
        rest.revert_project(&session, 0).await,
        Err(HistoryError::CannotRevert)
    );
    assert!(watcher.take_events("removeEntity").is_empty());
    assert_eq!(
        sent(&mock, "POST", "/revert_file").len(),
        1,
        "a refused revert is not retried"
    );
}

#[tokio::test]
async fn a_project_restore_reverts_each_file_and_deletes_later_ones() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.ranges_support = true);
    let (rest, session) = rest_for(&mock, "bob").await;
    let root = EntityId(mock.root_folder_id());
    let created = rest.create_doc(&session, &root, "later.tex").await.unwrap();
    let mut watcher = mock.peer("dave");
    let reverted = rest.revert_project(&session, 0).await.unwrap();
    let mut paths: Vec<String> = reverted
        .iter()
        .filter_map(|entry| entry.path.clone())
        .collect();
    paths.sort();
    assert_eq!(paths, ["figure.png", "main.tex", "refs.bib"]);
    let removed: Vec<serde_json::Value> = watcher
        .take_events("removeEntity")
        .into_iter()
        .map(|args| args[0].clone())
        .collect();
    assert!(removed.contains(&json!(created.0)));
    assert_eq!(removed.len(), 4);
}

#[tokio::test]
async fn a_project_restore_slower_than_the_read_timeout_still_answers() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.ranges_support = true);
    let (rest, session) = rest_for(&mock, "bob").await;
    let route = format!("/project/{}/revert-project", mock.project_id());
    mock.plan_fault(Some("POST"), &route, Fault::Delay(Duration::from_secs(90)));
    tokio::time::pause();
    let reverting = tokio::spawn(async move { rest.revert_project(&session, 0).await });
    until_sent(&mock, &route, &reverting).await;
    tokio::time::advance(Duration::from_secs(91)).await;
    let reverted = reverting.await.unwrap();
    assert!(reverted.is_ok(), "{reverted:?}");
}

#[tokio::test]
async fn restore_writes_are_never_retried_when_the_reply_is_lost() {
    let mock = MockOverleaf::start(project()).await;
    mock.configure(|config| config.ranges_support = true);
    let (rest, session) = rest_for(&mock, "bob").await;
    mock.plan_fault(
        Some("POST"),
        &format!("/project/{}/revert_file", mock.project_id()),
        Fault::LoseReply,
    );
    let lost = rest.revert_file(&session, 0, "main.tex").await;
    assert!(
        matches!(lost, Err(HistoryError::Rest(RestError::Lost(_)))),
        "{lost:?}"
    );
    assert_eq!(sent(&mock, "POST", "/revert_file").len(), 1);
}

#[tokio::test]
async fn a_version_zip_is_a_real_archive_and_402_is_the_plan_limit() {
    let mock = MockOverleaf::start(project()).await;
    let (rest, session) = rest_for(&mock, "dave").await;
    let zip = tempfile::NamedTempFile::new().unwrap();
    let mut last = None;
    let size = rest
        .version_zip(&session, 0, zip.path(), |done, total| {
            last = Some((done, total))
        })
        .await
        .unwrap();
    assert_eq!(last, Some((size, Some(size))));
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip.path()).unwrap()).unwrap();
    let mut text = String::new();
    std::io::Read::read_to_string(&mut archive.by_name("main.tex").unwrap(), &mut text).unwrap();
    assert_eq!(text, "First draft");
    mock.configure(|config| config.zip_status = 402);
    assert_eq!(
        rest.version_zip(&session, 0, zip.path(), |_, _| {}).await,
        Err(HistoryError::PlanLimit)
    );
    mock.configure(|config| config.zip_status = 429);
    assert!(matches!(
        rest.version_zip(&session, 0, zip.path(), |_, _| {}).await,
        Err(HistoryError::Rest(RestError::RateLimited(_)))
    ));
}

#[tokio::test]
async fn an_oversized_history_reply_is_refused() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        while let Ok((mut stream, _)) = listener.accept().await {
            let mut seen = [0_u8; 4096];
            let _ = stream.read(&mut seen).await;
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 104857600\r\n\r\n{")
                .await;
        }
    });
    let http = Http::new(&base, "Oleafly/test").unwrap();
    let page = Arc::new(ProjectPage::unloaded("64f0c0ffee0123456789abcd").unwrap());
    let rest = ProjectRest::new(http, page, "64f0c0ffee0123456789abcd");
    let session = SessionHandle::new(
        &base,
        Session {
            cookie: "overleaf.sid=s".into(),
            user_id: "u1".into(),
            email: String::new(),
            saved_by: None,
        },
        None,
    );
    let refused = tokio::time::timeout(Duration::from_secs(20), rest.updates(&session, None, 10))
        .await
        .expect("the reply was refused before it was read");
    assert!(
        matches!(refused, Err(HistoryError::Rest(RestError::Unreadable(_)))),
        "{refused:?}"
    );
}

#[tokio::test]
async fn settings_send_only_the_keys_given_and_echo_back() {
    let mock = MockOverleaf::start(project()).await;
    let (rest, session) = rest_for(&mock, "bob").await;
    let mut watcher = mock.peer("dave");
    let refs = DocId(mock.doc_id("refs.bib"));
    rest.update_settings(
        &session,
        &SettingsUpdate {
            compiler: Some("xelatex".into()),
            bibliography: Some(refs.clone()),
            ..SettingsUpdate::default()
        },
    )
    .await
    .unwrap();
    let posted = sent(&mock, "POST", "/settings");
    let body: serde_json::Value = serde_json::from_str(&posted.last().unwrap().body).unwrap();
    assert_eq!(
        body,
        json!({ "compiler": "xelatex", "mainBibliographyDocId": refs.0 })
    );
    assert_eq!(
        watcher.take_events("compilerUpdated"),
        vec![vec![json!("xelatex")]]
    );
    assert_eq!(
        watcher.take_events("mainBibliographyDocUpdated"),
        vec![vec![json!(refs.0)]]
    );
    let before = sent(&mock, "POST", "/settings").len();
    rest.update_settings(&session, &SettingsUpdate::default())
        .await
        .unwrap();
    assert_eq!(
        sent(&mock, "POST", "/settings").len(),
        before,
        "an empty change sends nothing"
    );
    assert!(matches!(
        rest.update_settings(
            &session,
            &SettingsUpdate {
                compiler: Some("tectonic".into()),
                ..SettingsUpdate::default()
            }
        )
        .await,
        Err(RestError::Refused { status: 400, .. })
    ));
    assert_eq!(sent(&mock, "POST", "/settings").len(), before);
    let (carol, carol_session) = rest_for(&mock, "carol").await;
    assert_eq!(
        carol
            .update_settings(
                &carol_session,
                &SettingsUpdate {
                    spelling: Some("de".into()),
                    ..SettingsUpdate::default()
                }
            )
            .await,
        Err(RestError::NotAllowed)
    );
    let (images, languages) = rest.choices();
    assert!(images.is_empty(), "CE lists no TeX Live images");
    assert!(languages.iter().any(|language| language.code == "en_US"));
}
