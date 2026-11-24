use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::{Fault, MockProject, MockUser, Privilege};
use serde_json::{json, Value};

use super::rig::{eventually, run, OverleafRig};
use super::tree_events::LinkedFile;
use super::TreeNoticeKind;
use crate::collab::commands::CollabCommandError;

const MAIN: &str = "main.tex";
const BIB: &[u8] = b"@book{a}\n";
const DISK: &[(&str, &str)] = &[(MAIN, "\\cite{a}\n")];

fn project() -> MockProject {
    MockProject::new("linked")
        .member(MockUser::named("bob"), Privilege::Review)
        .doc(MAIN, "\\cite{a}\n")
}

fn link() -> Value {
    json!({ "provider": "project_file", "source_project_id": "64b7f0c2a1e3d4b5c6a7e8f9", "source_entity_path": "/sample.bib", "importedAt": "2026-11-23T00:00:00.000Z" })
}

fn source() -> LinkedFile {
    LinkedFile {
        path: "refs.bib".into(),
        provider: "project_file".into(),
        url: None,
        source_project: Some("64b7f0c2a1e3d4b5c6a7e8f9".into()),
        source_path: Some("/sample.bib".into()),
    }
}

fn linked_notices(rig: &OverleafRig) -> Vec<Vec<LinkedFile>> {
    rig.host
        .tree
        .lock()
        .unwrap()
        .iter()
        .filter_map(|notice| match &notice.kind {
            TreeNoticeKind::Linked { files } => Some(files.clone()),
            _ => None,
        })
        .collect()
}

fn kept_notices(rig: &OverleafRig) -> Vec<Vec<String>> {
    rig.host
        .tree
        .lock()
        .unwrap()
        .iter()
        .filter_map(|notice| match &notice.kind {
            TreeNoticeKind::LinkedKept { paths } => Some(paths.clone()),
            _ => None,
        })
        .collect()
}

async fn with_link(rig: &OverleafRig) {
    rig.mock.add_linked_file("refs.bib", link(), BIB);
    eventually("the linked file is written and announced", || {
        rig.bytes("refs.bib") == BIB && !linked_notices(rig).is_empty()
    })
    .await;
}

fn refresh_route(rig: &OverleafRig) -> String {
    format!("/project/{}/linked_file/", rig.mock.project_id())
}

async fn refresh(rig: &OverleafRig, path: &str) -> Result<(), CollabCommandError> {
    rig.live
        .refresh_linked(path)
        .await
        .map_err(CollabCommandError::from)
}

#[test]
fn a_linked_file_is_announced_once_and_a_refresh_writes_its_new_bytes() {
    run(async {
        let rig = OverleafRig::start(project(), DISK).await;
        with_link(&rig).await;
        assert_eq!(linked_notices(&rig), vec![vec![source()]]);
        rig.mock
            .change_link_source("refs.bib", b"@book{a}\n@book{b}\n");
        refresh(&rig, "refs.bib").await.unwrap();
        eventually("the refreshed bytes are on disk", || {
            rig.bytes("refs.bib") == b"@book{a}\n@book{b}\n"
        })
        .await;
        rig.live.flush().await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(linked_notices(&rig), vec![vec![source()]]);
        assert!(rig.host.removed.lock().unwrap().is_empty());
        let other = refresh(&rig, MAIN).await.unwrap_err();
        assert_eq!(other.code, "invalid");
        assert_eq!(rig.mock.requests(&refresh_route(&rig)).len(), 1);
        rig.finish().await;
    });
}

#[test]
fn refresh_failures_reach_the_page_with_codes_it_knows() {
    run(async {
        let rig = OverleafRig::start(project(), DISK).await;
        with_link(&rig).await;
        let route = refresh_route(&rig);
        let not_shared = "The project that contains this file is not shared with you";
        for (faults, expected_code, expected_message) in [
            (vec![(400, "")], "linked_off_server", None),
            (
                vec![(403, not_shared), (403, not_shared)],
                "linked_refresh_failed",
                Some(not_shared),
            ),
            (
                vec![(422, "Your URL could not be reached")],
                "linked_refresh_failed",
                Some("Your URL could not be reached"),
            ),
            (
                vec![(429, "{\"message\":\"rate_limited\"}")],
                "rate_limited",
                None,
            ),
            (vec![(404, "<!DOCTYPE html>")], "not_found", None),
            (vec![(500, "boom")], "unreachable", None),
        ] {
            for (status, text) in faults {
                rig.mock
                    .plan_fault(Some("POST"), &route, Fault::Reply(status, text.into()));
            }
            let error = refresh(&rig, "refs.bib").await.unwrap_err();
            assert_eq!(error.code, expected_code, "{error:?}");
            if let Some(message) = expected_message {
                assert_eq!(error.message, message);
            }
        }
        rig.finish().await;
    });
}

#[test]
fn a_reviewer_cannot_refresh_and_nothing_is_sent() {
    run(async {
        let rig = OverleafRig::start_as(project(), DISK, "bob").await;
        with_link(&rig).await;
        let error = refresh(&rig, "refs.bib").await.unwrap_err();
        assert_eq!(error.code, "forbidden");
        assert!(rig.mock.requests(&refresh_route(&rig)).is_empty());
        rig.finish().await;
    });
}

#[test]
fn an_outside_edit_of_a_linked_file_stays_here_and_is_told_once() {
    run(async {
        let rig = OverleafRig::start(project(), DISK).await;
        with_link(&rig).await;
        std::fs::write(rig.root.join("refs.bib"), b"@book{mine}\n").unwrap();
        for _ in 0..2 {
            rig.live
                .import_paths(Some(vec!["refs.bib".to_owned()]))
                .await
                .unwrap();
        }
        eventually("the edit is told", || !kept_notices(&rig).is_empty()).await;
        assert_eq!(kept_notices(&rig), vec![vec!["refs.bib".to_owned()]]);
        let uploads = format!("/project/{}/upload", rig.mock.project_id());
        assert!(rig.mock.requests(&uploads).is_empty());
        assert_eq!(rig.mock.file_bytes("refs.bib").as_deref(), Some(BIB));
        assert_eq!(rig.mock.linked_data("refs.bib")["provider"], "project_file");
        rig.finish().await;
    });
}

#[test]
fn learned_words_carry_the_account_and_batches_report_where_they_stopped() {
    run(async {
        let rig = OverleafRig::start(project(), DISK).await;
        let learned = rig.live.learned_words();
        let alice = rig.mock.user("alice").id;
        assert_eq!(
            learned.account,
            format!(
                "{}\n{alice}",
                oleafly_online::session::origin_of(&rig.mock.base)
            )
        );
        assert_eq!(learned.words, Some(Vec::new()));
        let words: Vec<String> = ["alpha", "beta"].map(String::from).to_vec();
        let sent = rig.live.learn_words(&words, &[]).await.unwrap();
        assert_eq!(sent.learned, words);
        assert_eq!(sent.stopped, None);
        let many: Vec<String> = (0..201).map(|at| format!("w{at}")).collect();
        let error = CollabCommandError::from(rig.live.learn_words(&many, &[]).await.unwrap_err());
        assert_eq!(error.code, "invalid");
        rig.mock.configure(|config| config.dictionary_bytes = 12);
        let full = rig
            .live
            .learn_words(
                &["gamma".to_owned(), "delta".to_owned()],
                &["alpha".to_owned()],
            )
            .await
            .unwrap();
        assert_eq!(full.unlearned, ["alpha"]);
        assert_eq!(full.learned, ["gamma"]);
        assert_eq!(full.stopped, Some("too_large"));
        rig.mock
            .plan_fault(Some("POST"), "/spelling/", Fault::Reply(401, String::new()));
        let signed_out = rig
            .live
            .learn_words(&[], &["beta".to_owned()])
            .await
            .unwrap();
        assert_eq!(signed_out.stopped, Some("signed_out"));
        assert_eq!(rig.mock.learned_words("alice"), ["beta", "gamma"]);
        rig.finish().await;
    });
}
