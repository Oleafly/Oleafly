use std::time::{Duration, Instant};

use serde_json::json;

use super::super::linked::LinkedError;
use super::super::spelling::{SpellStop, SPELL_BATCH};
use super::tree::{live_as, quick, TreePort};
use super::{eventually, project, Rig, FILES};
use crate::live::rest::RestError;
use crate::realtime::events::EntityId;
use crate::realtime::tree::{LinkedSource, NodeKind, PathChange};
use crate::test_support::mock_overleaf::{Fault, MockProject, Privilege};

const BIB: &[u8] = b"@book{a}";

fn rig_project() -> MockProject {
    project()
        .file("refs.bib", BIB)
        .file("plot.png", b"\x89PNG plot")
}

async fn linked_rig() -> Rig {
    let rig = Rig::start(rig_project()).await;
    rig.mock.link_file(
        "refs.bib",
        json!({ "provider": "project_file", "source_project_id": "p2", "source_entity_path": "/sample.bib" }),
        BIB,
    );
    rig
}

fn port() -> std::sync::Arc<TreePort> {
    let port = TreePort::new();
    for (path, text) in FILES {
        port.text(path, text);
    }
    port
}

fn file(rig: &Rig, path: &str) -> EntityId {
    EntityId(rig.mock.entity_id(path).unwrap())
}

#[tokio::test]
async fn a_refresh_replaces_the_file_in_place_and_its_new_bytes_download() {
    let rig = linked_rig().await;
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let old = file(&rig, "refs.bib");
    let linked = live
        .nodes()
        .into_iter()
        .find(|node| node.id == old)
        .and_then(|node| node.linked);
    assert_eq!(
        linked,
        Some(LinkedSource {
            provider: "project_file".into(),
            url: None,
            source_project: Some("p2".into()),
            source_path: Some("/sample.bib".into()),
        })
    );
    rig.mock
        .change_link_source("refs.bib", b"@book{a}\n@book{b}");
    let fresh = live.refresh_linked(&old).await.unwrap();
    eventually("the refresh replaces the file", || {
        port.seen().trees.iter().flatten().any(|change| {
            matches!(change, PathChange::Replaced { old: was, new: now, path, from: NodeKind::File, to: NodeKind::File }
                if *was == old && *now == fresh && path == "refs.bib")
        })
    })
    .await;
    let node = live
        .nodes()
        .into_iter()
        .find(|node| node.id == fresh)
        .unwrap();
    assert!(node.linked.is_some());
    let bytes = live.download(&fresh, &mut |_, _| {}).await.unwrap();
    assert_eq!(bytes, b"@book{a}\n@book{b}");
    let sent = rig.mock.requests(&format!(
        "/project/{}/linked_file/{}/refresh",
        rig.mock.project_id(),
        old.0
    ));
    assert_eq!(sent.len(), 1);
    assert!(sent[0].body.contains("\"shouldReindexReferences\":true"));
    live.stop().await;
}

#[tokio::test]
async fn refusals_are_told_apart_and_local_ones_send_nothing() {
    let rig = linked_rig().await;
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let refs = file(&rig, "refs.bib");
    let route = format!("/project/{}/linked_file/", rig.mock.project_id());
    assert_eq!(
        live.refresh_linked(&file(&rig, "plot.png")).await,
        Err(LinkedError::NotLinked)
    );
    assert_eq!(
        live.refresh_linked(&EntityId("5f9a1b2c3d4e5f6a7b8c9d0e".into()))
            .await,
        Err(LinkedError::Unknown)
    );
    assert_eq!(
        live.refresh_linked(&EntityId(rig.mock.doc_id("main.tex")))
            .await,
        Err(LinkedError::NotLinked)
    );
    assert!(rig.mock.requests(&route).is_empty());
    for (status, text, expected) in [
        (400, "", LinkedError::Off),
        (404, "<!DOCTYPE html><p>Not found</p>", LinkedError::Gone),
        (409, "Conflict", LinkedError::NotLinked),
        (
            404,
            "Source file not found",
            LinkedError::Refused {
                status: 404,
                message: "Source file not found".into(),
            },
        ),
        (
            422,
            "Your URL could not be reached",
            LinkedError::Refused {
                status: 422,
                message: "Your URL could not be reached".into(),
            },
        ),
        (
            429,
            "{\"message\":\"rate_limited\"}",
            LinkedError::Rest(RestError::RateLimited(None)),
        ),
    ] {
        rig.mock
            .plan_fault(Some("POST"), &route, Fault::Reply(status, text.into()));
        assert_eq!(live.refresh_linked(&refs).await, Err(expected), "{status}");
    }
    live.stop().await;
    assert_eq!(live.refresh_linked(&refs).await, Err(LinkedError::Ended));
}

#[tokio::test]
async fn a_reviewer_is_refused_by_the_server() {
    let rig = Rig::start(rig_project()).await;
    rig.mock
        .link_file("refs.bib", json!({ "provider": "project_file" }), BIB);
    rig.mock.set_privilege("bob", Some(Privilege::Review));
    let port = port();
    let live = live_as(&rig, "bob", &port, quick()).await;
    assert_eq!(
        live.refresh_linked(&file(&rig, "refs.bib")).await,
        Err(LinkedError::NotAllowed)
    );
    live.stop().await;
}

#[tokio::test]
async fn stopping_ends_a_refresh_that_is_still_waiting_for_a_compile() {
    let rig = linked_rig().await;
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let refs = file(&rig, "refs.bib");
    rig.mock.plan_fault(
        Some("POST"),
        &format!("/project/{}/linked_file/", rig.mock.project_id()),
        Fault::Delay(Duration::from_secs(600)),
    );
    let waiting = {
        let live = std::sync::Arc::clone(&live);
        tokio::spawn(async move { live.refresh_linked(&refs).await })
    };
    eventually("the refresh is sent", || {
        rig.mock
            .requests("/project/")
            .iter()
            .any(|request| request.path.contains("/linked_file/"))
    })
    .await;
    let started = Instant::now();
    assert!(live.stop_within(Duration::from_secs(8)).await);
    let outcome = tokio::time::timeout(Duration::from_secs(5), waiting)
        .await
        .expect("the refresh outlived the session")
        .unwrap();
    assert_eq!(outcome, Err(LinkedError::Ended));
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
}

#[tokio::test]
async fn learned_words_come_from_the_page_and_a_batch_unlearns_before_it_learns() {
    let rig = Rig::start(project()).await;
    rig.mock
        .set_learned_words("alice", &["Zeta", "zeta", "Oleaflyish"]);
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    assert_eq!(
        live.learned_words(),
        Some(vec![
            "Oleaflyish".to_string(),
            "Zeta".to_string(),
            "zeta".to_string()
        ])
    );
    let learn: Vec<String> = ["Größenordnungsx", "two words", "bad\u{0}word"]
        .map(String::from)
        .to_vec();
    let unlearn = vec!["Zeta".to_string(), "zeta".to_string()];
    let spelled = live.spell(&learn, &unlearn).await;
    assert_eq!(spelled.unlearned, unlearn);
    assert_eq!(spelled.learned, ["Größenordnungsx", "two words"]);
    assert_eq!(spelled.stopped, None);
    assert_eq!(
        rig.mock.learned_words("alice"),
        ["Oleaflyish", "Größenordnungsx", "two words"]
    );
    let order: Vec<String> = rig
        .mock
        .requests("/spelling/")
        .iter()
        .map(|request| request.path.clone())
        .collect();
    assert_eq!(
        order,
        [
            "/spelling/unlearn",
            "/spelling/unlearn",
            "/spelling/learn",
            "/spelling/learn"
        ]
    );
    let many: Vec<String> = (0..SPELL_BATCH + 20)
        .map(|at| format!("word{at}"))
        .collect();
    let spelled = live.spell(&many, &[]).await;
    assert_eq!(spelled.learned.len(), SPELL_BATCH);
    live.stop().await;
}

#[tokio::test]
async fn a_full_dictionary_stops_the_batch_and_keeps_what_was_done() {
    let rig = Rig::start(project()).await;
    rig.mock.configure(|config| config.dictionary_bytes = 10);
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    let learn: Vec<String> = ["alpha", "beta", "gamma"].map(String::from).to_vec();
    let spelled = live.spell(&learn, &[]).await;
    assert_eq!(spelled.learned, ["alpha", "beta"]);
    assert_eq!(spelled.stopped, Some(SpellStop::Full));
    assert_eq!(rig.mock.learned_words("alice"), ["alpha", "beta"]);
    assert_eq!(rig.mock.requests("/spelling/learn").len(), 3);
    live.stop().await;
}

#[tokio::test]
async fn stopping_ends_a_spelling_batch_and_keeps_what_was_done() {
    let rig = Rig::start(project()).await;
    let port = port();
    let live = live_as(&rig, "alice", &port, quick()).await;
    rig.mock.plan_fault(
        Some("POST"),
        "/spelling/unlearn",
        Fault::Delay(Duration::from_secs(600)),
    );
    let batch = {
        let live = std::sync::Arc::clone(&live);
        tokio::spawn(async move {
            live.spell(
                &["late".to_string()],
                &["first".to_string(), "second".to_string()],
            )
            .await
        })
    };
    eventually("the first unlearn is sent", || {
        !rig.mock.requests("/spelling/unlearn").is_empty()
    })
    .await;
    assert!(live.stop_within(Duration::from_secs(8)).await);
    let spelled = tokio::time::timeout(Duration::from_secs(5), batch)
        .await
        .expect("the batch outlived the session")
        .unwrap();
    assert_eq!(spelled.stopped, Some(SpellStop::Ended));
    assert!(spelled.learned.is_empty());
    assert_eq!(rig.mock.requests("/spelling/").len(), 1);
    let after = live.spell(&["again".to_string()], &[]).await;
    assert_eq!(after.stopped, Some(SpellStop::Ended));
}
