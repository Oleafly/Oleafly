use std::sync::Arc;
use std::time::{Duration, Instant};

use super::super::{LivePort, OverleafSession, SessionTuning};
use super::{eventually, manifest_of, tuning, Port, Rig};
use crate::test_support::mock_overleaf::MockProject;

const DOCS: [&str; 7] = [
    "a.tex",
    "b.tex",
    "c.tex",
    "chapters/d.tex",
    "chapters/e.tex",
    "f.tex",
    "main.tex",
];

fn opened() -> MockProject {
    let mut project = MockProject::new("opened").root_doc("main.tex");
    for path in DOCS {
        project = project.doc(path, &format!("text of {path}"));
    }
    project.file("figure.png", b"\x89PNG")
}

fn paced(batch: usize, every: Duration) -> SessionTuning {
    SessionTuning {
        legacy_batch: batch,
        legacy_every: every,
        ..tuning()
    }
}

async fn opening(rig: &Rig, port: &Arc<Port>, tuning: SessionTuning) -> Arc<OverleafSession> {
    let mut config = rig.config("alice", tuning);
    config.fill = true;
    let journal = rig.journal("alice").await;
    OverleafSession::start(config, Arc::clone(port) as Arc<dyn LivePort>, journal)
        .await
        .unwrap()
}

fn filled(port: &Port) -> bool {
    port.seen().filling.last() == Some(&(DOCS.len(), DOCS.len()))
}

#[tokio::test]
async fn opening_a_project_joins_its_main_file_first_then_the_rest_in_paced_batches() {
    let rig = Rig::start(opened()).await;
    let port = Port::new(&[]);
    let every = Duration::from_millis(150);
    let started = Instant::now();
    let live = opening(&rig, &port, paced(2, every)).await;
    eventually("every doc is filled in", || filled(&port)).await;
    let elapsed = started.elapsed();
    let joins = rig.joins_except(&[]);
    assert_eq!(joins.first(), Some(&rig.id("main.tex").0));
    assert_eq!(joins.len(), DOCS.len());
    assert!(elapsed >= every * 2, "filled in {elapsed:?}");
    let told = port.seen().filling.clone();
    assert_eq!(told.first().map(|(_, total)| *total), Some(DOCS.len()));
    assert!(
        told.windows(2).all(|pair| pair[0].0 < pair[1].0),
        "{told:?}"
    );
    assert!(told.len() >= 3, "{told:?}");
    assert!(rig
        .mock
        .requests("/project")
        .iter()
        .all(|request| !request.path.contains("/download/zip")));
    eventually("the history version is kept", || {
        manifest_of(&live).is_some_and(|manifest| manifest.history_version.is_some())
    })
    .await;
    live.stop().await;
}

#[tokio::test]
async fn an_interrupted_open_carries_on_at_the_next_start() {
    let rig = Rig::start(opened()).await;
    let port = Port::new(&[]);
    let slow = opening(&rig, &port, paced(1, Duration::from_secs(60))).await;
    eventually("the main file is joined", || {
        rig.has_joined("alice", &rig.id("main.tex"))
    })
    .await;
    assert!(!filled(&port));
    slow.stop().await;
    assert_eq!(
        manifest_of(&slow).and_then(|manifest| manifest.history_version),
        None
    );
    drop(slow);

    let port = Port::new(&[]);
    let live = opening(&rig, &port, paced(4, Duration::from_millis(20))).await;
    eventually("the rest is filled in", || filled(&port)).await;
    eventually("the history version is kept", || {
        manifest_of(&live).is_some_and(|manifest| manifest.history_version.is_some())
    })
    .await;
    live.stop().await;
    drop(live);

    let port = Port::new(&[]);
    let again = opening(&rig, &port, paced(4, Duration::from_millis(20))).await;
    eventually("a finished open reports nothing left", || {
        port.seen().filling.last() == Some(&(0, 0))
    })
    .await;
    again.stop().await;
}
