use std::time::Duration;

use serde_json::{json, Value};

use super::super::tests::{rest_for, until_sent};
use super::super::{RestError, REFRESH_DEADLINE};
use crate::realtime::events::EntityId;
use crate::test_support::mock_overleaf::{Fault, MockOverleaf, MockProject, MockUser, Privilege};

const SOURCE: &str = "64b7f0c2a1e3d4b5c6a7e8f9";

fn linked_project() -> MockProject {
    MockProject::new("Linked")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .token_viewer(MockUser::named("erin"))
        .doc("main.tex", "\\cite{a}")
        .file("refs.bib", b"@book{a}")
        .file("frog.jpg", b"\xff\xd8 frog")
}

fn link() -> Value {
    json!({ "provider": "project_file", "source_project_id": SOURCE, "source_entity_path": "/sample.bib", "importedAt": "2026-11-23T00:00:00.000Z" })
}

async fn linked() -> MockOverleaf {
    let mock = MockOverleaf::start(linked_project()).await;
    mock.link_file("refs.bib", link(), b"@book{a}");
    mock
}

fn file(mock: &MockOverleaf, path: &str) -> EntityId {
    EntityId(mock.entity_id(path).unwrap())
}

#[tokio::test]
async fn a_refresh_posts_an_empty_body_and_answers_the_new_file() {
    let mock = linked().await;
    mock.change_link_source("refs.bib", b"@book{a}\n@book{b}");
    let (rest, alice) = rest_for(&mock, "alice").await;
    let mut watcher = mock.peer("bob");
    let old = file(&mock, "refs.bib");
    let fresh = rest
        .refresh_linked(&alice, &old, true, REFRESH_DEADLINE)
        .await
        .unwrap();
    assert_ne!(fresh, old);
    assert_eq!(mock.entity_id("refs.bib"), Some(fresh.0.clone()));
    assert_eq!(
        mock.file_bytes("refs.bib").as_deref(),
        Some(&b"@book{a}\n@book{b}"[..])
    );
    assert_eq!(
        mock.linked_data("refs.bib")["source_entity_path"],
        "/sample.bib"
    );
    let removed = watcher.events("removeEntity");
    assert_eq!(removed, [vec![json!(old.0), json!("upload")]]);
    let arrived = watcher.events("reciveNewFile");
    assert_eq!(arrived.len(), 1);
    assert_eq!(arrived[0][1]["_id"], json!(fresh.0));
    assert_eq!(arrived[0][3], mock.linked_data("refs.bib"));
    assert_eq!(
        watcher.events("references:keys:updated"),
        [vec![json!([]), json!(true), Value::Null]]
    );
    let project = mock.project_id();
    let sent = mock.requests(&format!("/project/{project}/linked_file/{}/refresh", old.0));
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].method, "POST");
    assert_eq!(
        serde_json::from_str::<Value>(&sent[0].body).unwrap(),
        json!({ "shouldReindexReferences": true })
    );
    assert!(sent[0].headers.contains_key("x-csrf-token"));
    assert_eq!(
        rest.refresh_linked(&alice, &old, false, REFRESH_DEADLINE)
            .await,
        Err(RestError::Refused {
            status: 404,
            message: "<!DOCTYPE html><html><body>Not found</body></html>".into(),
        })
    );
}

#[tokio::test]
async fn each_refusal_keeps_its_status_and_the_servers_words() {
    let mock = linked().await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let refs = file(&mock, "refs.bib");
    let frog = file(&mock, "frog.jpg");
    assert_eq!(
        rest.refresh_linked(&alice, &frog, false, REFRESH_DEADLINE)
            .await,
        Err(RestError::Refused {
            status: 409,
            message: "Conflict".into(),
        })
    );
    assert_eq!(
        rest.refresh_linked(&alice, &EntityId("nope".into()), false, REFRESH_DEADLINE)
            .await
            .map_err(|error| matches!(error, RestError::Refused { status: 404, .. })),
        Err(true)
    );
    assert_eq!(
        rest.refresh_linked(&alice, &EntityId("../x".into()), false, REFRESH_DEADLINE)
            .await,
        Err(RestError::Refused {
            status: 400,
            message: "a file id with unexpected characters".into(),
        })
    );
    let route = format!("/project/{}/linked_file/", mock.project_id());
    let not_shared = "The project that contains this file is not shared with you";
    for (status, text, expected) in [
        (
            400,
            "",
            RestError::Refused {
                status: 400,
                message: String::new(),
            },
        ),
        (
            422,
            "Your URL could not be reached",
            RestError::Refused {
                status: 422,
                message: "Your URL could not be reached".into(),
            },
        ),
        (
            400,
            "You are not the original importer of this file",
            RestError::Refused {
                status: 400,
                message: "You are not the original importer of this file".into(),
            },
        ),
        (
            429,
            "{\"message\":\"rate_limited\"}",
            RestError::RateLimited(None),
        ),
    ] {
        mock.plan_fault(Some("POST"), &route, Fault::Reply(status, text.into()));
        assert_eq!(
            rest.refresh_linked(&alice, &refs, false, REFRESH_DEADLINE)
                .await,
            Err(expected),
            "{status} {text}"
        );
    }
    for _ in 0..2 {
        mock.plan_fault(Some("POST"), &route, Fault::Reply(403, not_shared.into()));
    }
    assert_eq!(
        rest.refresh_linked(&alice, &refs, false, REFRESH_DEADLINE)
            .await,
        Err(RestError::Refused {
            status: 403,
            message: not_shared.into(),
        })
    );
    for name in ["carol", "dave", "erin"] {
        let (rest, someone) = rest_for(&mock, name).await;
        assert_eq!(
            rest.refresh_linked(&someone, &refs, false, REFRESH_DEADLINE)
                .await,
            Err(RestError::NotAllowed),
            "{name}"
        );
    }
    assert_eq!(mock.entity_id("refs.bib"), Some(refs.0));
}

#[tokio::test]
async fn a_stale_token_is_fetched_again_once_before_the_refresh() {
    let mock = linked().await;
    let (rest, bob) = rest_for(&mock, "bob").await;
    mock.rotate_csrf();
    let refs = file(&mock, "refs.bib");
    assert!(rest
        .refresh_linked(&bob, &refs, false, REFRESH_DEADLINE)
        .await
        .is_ok());
}

#[tokio::test]
async fn a_refresh_that_never_answers_gives_up_at_its_total() {
    let mock = linked().await;
    let (rest, alice) = rest_for(&mock, "alice").await;
    let refs = file(&mock, "refs.bib");
    let route = format!("/project/{}/linked_file/", mock.project_id());
    mock.plan_fault(
        Some("POST"),
        &route,
        Fault::Delay(Duration::from_secs(3_600)),
    );
    let total = Duration::from_secs(240);
    tokio::time::pause();
    let started = tokio::time::Instant::now();
    let waiting =
        tokio::spawn(async move { rest.refresh_linked(&alice, &refs, false, total).await });
    until_sent(&mock, &route, &waiting).await;
    tokio::time::advance(total).await;
    let outcome = waiting.await.unwrap();
    let waited = started.elapsed();
    assert!(matches!(outcome, Err(RestError::Lost(_))), "{outcome:?}");
    assert!(
        waited >= total && waited < Duration::from_secs(3_600),
        "{waited:?}"
    );
}
