use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::MockProject;

use super::notices::OverleafNotice;
use super::rig::{eventually, run, FirstStart, OverleafRig, Place};

const MAIN: &str = "main.tex";
const IMPORTED: &str = "Hello";
const LOCAL: &str = "Oh, Hello";

fn project(server: &str) -> MockProject {
    MockProject::new("first start").doc(MAIN, server)
}

async fn joined(rig: &OverleafRig) {
    let doc = rig.doc(MAIN);
    let alice = rig.mock.user("alice").id;
    eventually("the doc is joined", || {
        rig.mock.connections().iter().any(|connection| {
            connection.user_id.as_deref() == Some(alice.as_str())
                && connection.joined.contains(&doc)
        })
    })
    .await;
    tokio::time::sleep(Duration::from_millis(500)).await;
}

fn reviews(rig: &OverleafRig) -> Vec<OverleafNotice> {
    rig.host
        .notices
        .lock()
        .unwrap()
        .iter()
        .map(|payload| payload.notice.clone())
        .filter(|notice| matches!(notice, OverleafNotice::NeedsReview { .. }))
        .collect()
}

fn review(theirs: &str) -> OverleafNotice {
    OverleafNotice::NeedsReview {
        path: MAIN.into(),
        mine: LOCAL.into(),
        theirs: theirs.into(),
    }
}

async fn unbased(server: &str) -> OverleafRig {
    OverleafRig::start_first(
        project(server),
        &[(MAIN, LOCAL)],
        Place::Scratch,
        FirstStart::default(),
    )
    .await
}

#[test]
fn a_local_edit_with_no_base_and_a_changed_server_waits_for_review() {
    run(async {
        let rig = unbased("Hello world").await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        tab.catch_up();
        assert_eq!(rig.read(MAIN), LOCAL);
        assert_eq!(tab.text, LOCAL);
        assert_eq!(rig.mock.doc_text(&rig.doc(MAIN)), "Hello world");
        eventually("the review is announced", || {
            reviews(&rig) == vec![review("Hello world")]
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn a_local_edit_with_no_base_waits_for_review_even_when_the_server_kept_the_import() {
    run(async {
        let rig = unbased(IMPORTED).await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        tab.catch_up();
        assert_eq!(rig.read(MAIN), LOCAL);
        assert_eq!(tab.text, LOCAL);
        assert_eq!(rig.mock.doc_text(&rig.doc(MAIN)), IMPORTED);
        eventually("the review is announced", || {
            reviews(&rig) == vec![review(IMPORTED)]
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn an_imported_base_lets_the_first_live_start_send_the_local_edit() {
    run(async {
        let rig = OverleafRig::start_first(
            project(IMPORTED),
            &[(MAIN, LOCAL)],
            Place::Scratch,
            FirstStart {
                imported: &[(MAIN, IMPORTED)],
                ..FirstStart::default()
            },
        )
        .await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        eventually("the local edit reaches the server", || {
            rig.mock.doc_text(&rig.doc(MAIN)) == LOCAL
        })
        .await;
        tab.catch_up();
        assert_eq!(rig.read(MAIN), LOCAL);
        assert_eq!(tab.text, LOCAL);
        assert!(reviews(&rig).is_empty());
        rig.finish().await;
    });
}

#[test]
fn an_imported_base_merges_a_local_edit_with_a_coauthors() {
    run(async {
        let rig = OverleafRig::start_first(
            project("Hello world"),
            &[(MAIN, LOCAL)],
            Place::Scratch,
            FirstStart {
                imported: &[(MAIN, IMPORTED)],
                ..FirstStart::default()
            },
        )
        .await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        eventually("the merge reaches the server", || {
            rig.mock.doc_text(&rig.doc(MAIN)) == "Oh, Hello world"
        })
        .await;
        eventually("the merge reaches the disk", || {
            rig.read(MAIN) == "Oh, Hello world"
        })
        .await;
        tab.catch_up();
        assert_eq!(tab.text, "Oh, Hello world");
        assert!(reviews(&rig).is_empty());
        rig.finish().await;
    });
}

async fn linked(server: &str) -> OverleafRig {
    OverleafRig::start_first(
        project(server),
        &[(MAIN, LOCAL)],
        Place::Scratch,
        FirstStart {
            git_base: &[(MAIN, IMPORTED)],
            ..FirstStart::default()
        },
    )
    .await
}

#[test]
fn a_git_linked_first_start_sends_the_local_edit() {
    run(async {
        let rig = linked(IMPORTED).await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        eventually("the local edit reaches the server", || {
            rig.mock.doc_text(&rig.doc(MAIN)) == LOCAL
        })
        .await;
        tab.catch_up();
        assert_eq!(rig.read(MAIN), LOCAL);
        assert_eq!(tab.text, LOCAL);
        assert!(reviews(&rig).is_empty());
        rig.finish().await;
    });
}

#[test]
fn a_git_linked_first_start_merges_with_a_coauthors_edit() {
    run(async {
        let rig = linked("Hello world").await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        eventually("the merge reaches the server and the disk", || {
            rig.mock.doc_text(&rig.doc(MAIN)) == "Oh, Hello world"
                && rig.read(MAIN) == "Oh, Hello world"
        })
        .await;
        tab.catch_up();
        assert_eq!(tab.text, "Oh, Hello world");
        assert!(reviews(&rig).is_empty());
        eventually("the merge is announced", || {
            rig.host
                .notices
                .lock()
                .unwrap()
                .iter()
                .any(|payload| matches!(payload.notice, OverleafNotice::Merged { .. }))
        })
        .await;
        rig.finish().await;
    });
}

/// Stores the started session late for one test, and back on time after it.
struct LateSession;

impl LateSession {
    fn by(delay: Duration) -> LateSession {
        let millis = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX);
        super::STORE_SESSION_LATE_MS.store(millis, std::sync::atomic::Ordering::Relaxed);
        LateSession
    }
}

impl Drop for LateSession {
    fn drop(&mut self) {
        super::STORE_SESSION_LATE_MS.store(0, std::sync::atomic::Ordering::Relaxed);
    }
}

fn announced_merge(rig: &OverleafRig) -> bool {
    rig.host
        .notices
        .lock()
        .unwrap()
        .iter()
        .any(|payload| matches!(payload.notice, OverleafNotice::Merged { .. }))
}

#[test]
fn a_merge_reported_while_the_session_joins_is_announced_once_it_has_started() {
    run(async {
        let _late = LateSession::by(Duration::from_millis(500));
        let rig = linked("Hello world").await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        eventually("the merge reaches the server and the disk", || {
            rig.mock.doc_text(&rig.doc(MAIN)) == "Oh, Hello world"
                && rig.read(MAIN) == "Oh, Hello world"
        })
        .await;
        tab.catch_up();
        assert_eq!(tab.text, "Oh, Hello world");
        eventually("the merge is announced", || announced_merge(&rig)).await;
        rig.finish().await;
    });
}

#[test]
fn a_review_reported_while_the_session_joins_is_still_asked_for() {
    run(async {
        let _late = LateSession::by(Duration::from_millis(500));
        let rig = unbased("Hello world").await;
        let mut tab = rig.open(MAIN);
        joined(&rig).await;
        tab.catch_up();
        assert_eq!(rig.read(MAIN), LOCAL);
        assert_eq!(rig.mock.doc_text(&rig.doc(MAIN)), "Hello world");
        eventually("the review is announced", || {
            reviews(&rig) == vec![review("Hello world")]
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn an_import_records_the_imported_text_outside_the_project() {
    let dir = tempfile::tempdir().unwrap();
    let (root, mirror) = (dir.path().join("project"), dir.path().join("mirror"));
    std::fs::create_dir_all(root.join("sections")).unwrap();
    std::fs::write(root.join(MAIN), "Hello\r\n").unwrap();
    std::fs::write(root.join("sections/intro.tex"), "Intro").unwrap();
    std::fs::write(root.join("figure.png"), [0_u8, 159, 146, 150]).unwrap();
    super::record_import_bases(&mirror, &root).unwrap();
    let recorded: std::collections::BTreeMap<String, String> =
        serde_json::from_slice(&std::fs::read(mirror.join(super::IMPORT_BASES)).unwrap()).unwrap();
    assert_eq!(recorded.get(MAIN).map(String::as_str), Some("Hello\n"));
    assert_eq!(
        recorded.get("sections/intro.tex").map(String::as_str),
        Some("Intro")
    );
    assert!(!recorded.contains_key("figure.png"));
    assert!(!root.join(super::IMPORT_BASES).exists());
}

#[test]
fn a_hooks_git_variables_never_reach_the_repository_the_rig_builds() {
    let dir = tempfile::tempdir().unwrap();
    let decoy = dir.path().join("decoy");
    std::fs::create_dir_all(&decoy).unwrap();
    let variables = [
        ("GIT_DIR", decoy.clone()),
        ("GIT_WORK_TREE", decoy.clone()),
        ("GIT_INDEX_FILE", decoy.join("index")),
        ("GIT_COMMON_DIR", decoy.clone()),
        ("GIT_PREFIX", decoy.join("sub")),
    ];
    let _inherited = crate::git::testing::inherit_git_env(
        variables
            .into_iter()
            .map(|(name, value)| (name.into(), value.into_os_string()))
            .collect(),
    );
    let repo = super::rig::git_base(dir.path(), &[(MAIN, IMPORTED)]).unwrap();
    assert!(
        std::fs::read_dir(&decoy).unwrap().next().is_none(),
        "a git command wrote into the hook's repository"
    );
    assert!(repo.join(".git").is_dir());
    let first = super::FirstBases {
        imported: Default::default(),
        git: Some(repo),
    };
    assert_eq!(first.base_of(MAIN).as_deref(), Some(IMPORTED));
}
