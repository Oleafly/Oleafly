use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};
use oleafly_ot::DocMessage;

use std::sync::Arc;

use oleafly_collab::{CollabError, CollabPaths};
use oleafly_online::live::journal::{DocRecord, Journal, SCHEMA};
use oleafly_online::realtime::DocId;

use super::refuse_overleaf_linked;
use super::rig::{eventually, OverleafRig, Place, Quiet};
use crate::collab::testing::TempLibrary;

const MAIN: &str = "main.tex";
const INTRO: &str = "sections/intro.tex";

fn project(main: &str, intro: &str) -> MockProject {
    MockProject::new("live")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, main)
        .doc(INTRO, intro)
}

fn run(test: impl std::future::Future<Output = ()>) {
    let _turn = crate::collab::live::write::rig::live_turn();
    tauri::async_runtime::block_on(test);
}

#[test]
fn typing_in_the_editor_reaches_the_server() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello world\n");
        eventually("the server has the typing", || {
            rig.mock.doc_text(&doc) == "Hello world\n"
        })
        .await;
        eventually("the mirror wrote the typing", || {
            rig.read(MAIN) == "Hello world\n"
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn a_coauthors_edit_to_an_unopened_doc_is_written_to_disk() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(INTRO);
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, "An ");
        bob.type_at(&doc, 3, "early ");
        eventually("the coauthor's edit reaches disk", || {
            rig.read(INTRO) == "An early Intro\n"
        })
        .await;
        assert_eq!(rig.read(MAIN), "Hello\n");
        rig.finish().await;
    });
}

#[test]
fn an_outside_edit_merges_as_an_op() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(INTRO);
        rig.edit(INTRO, "Intro, edited elsewhere\n");
        rig.live
            .import_paths(Some(vec![INTRO.to_owned()]))
            .await
            .unwrap();
        eventually("the outside edit reaches the server", || {
            rig.mock.doc_text(&doc) == "Intro, edited elsewhere\n"
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn crlf_file_stays_crlf_on_disk_and_lf_on_overleaf() {
    run(async {
        let rig = OverleafRig::start(
            project("one\ntwo\n", "Intro\n"),
            &[(MAIN, "one\r\ntwo\r\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, "zero\n");
        eventually("the coauthor's line reaches disk with CRLF", || {
            rig.bytes(MAIN) == b"zero\r\none\r\ntwo\r\n"
        })
        .await;
        rig.edit(MAIN, "zero\r\none\r\ntwo\r\nthree\r\n");
        rig.live
            .import_paths(Some(vec![MAIN.to_owned()]))
            .await
            .unwrap();
        eventually("the outside line reaches the server as LF", || {
            rig.mock.doc_text(&doc) == "zero\none\ntwo\nthree\n"
        })
        .await;
        assert_eq!(rig.bytes(MAIN), b"zero\r\none\r\ntwo\r\nthree\r\n");
        rig.finish().await;
    });
}

#[test]
fn a_compile_barrier_flushes_overleaf_texts_to_disk() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello, compiled\n");
        crate::collab::live::lifecycle::flush("overleaf-rig", false).await;
        assert_eq!(rig.read(MAIN), "Hello, compiled\n");
        rig.finish().await;
    });
}

#[test]
fn an_agent_write_becomes_one_op_and_shows_in_the_open_tab() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        let outcome = crate::collab::live::write::write_text(
            "overleaf-rig",
            MAIN,
            None,
            "Hello\nfrom the agent\n",
        )
        .await
        .unwrap();
        assert!(outcome.handled);
        assert_eq!(rig.read(MAIN), "Hello\nfrom the agent\n");
        eventually("the agent's edit reaches the server", || {
            rig.mock.doc_text(&doc) == "Hello\nfrom the agent\n"
        })
        .await;
        tab.catch_up();
        assert_eq!(tab.text, "Hello\nfrom the agent\n");
        assert!(tab
            .inbox
            .lock()
            .unwrap()
            .iter()
            .all(|message| !matches!(message, DocMessage::Reset { .. })));
        tokio::time::sleep(Duration::from_millis(50)).await;
        rig.finish().await;
    });
}

const SERVER: &str = "https://www.overleaf.com";
const LINKED: &str = "6af963ebc9037022065bb53f";

fn imported_project() -> String {
    let project_id = crate::project::create_blank_project("Imported".into()).unwrap();
    let mut meta = crate::project::read_meta(&project_id).unwrap();
    meta.extra.insert(
        "importedFrom".to_owned(),
        serde_json::json!({ "service": "overleaf", "server": SERVER, "projectId": LINKED }),
    );
    crate::project::write_meta(&project_id, &meta).unwrap();
    project_id
}

fn collab_paths() -> CollabPaths {
    CollabPaths::new(crate::paths::collab_root().unwrap())
}

fn code(error: CollabError) -> String {
    match error {
        CollabError::Api { code, .. } => code,
        other => panic!("expected a refusal, got {other}"),
    }
}

#[test]
fn an_import_only_project_shares_as_today_while_the_card_is_off() {
    let library = TempLibrary::new();
    let project = imported_project();
    assert!(refuse_overleaf_linked(&collab_paths(), &project, false).is_ok());
    drop(library);
}

#[test]
fn sharing_an_overleaf_linked_project_is_refused_while_the_card_is_on() {
    let library = TempLibrary::new();
    let project = imported_project();
    let refused = refuse_overleaf_linked(&collab_paths(), &project, true).unwrap_err();
    assert_eq!(code(refused), "overleaf_linked");
    drop(library);
}

#[test]
fn unsent_overleaf_work_refuses_sharing_even_with_the_card_off() {
    let library = TempLibrary::new();
    let project = imported_project();
    let data = crate::paths::oleafly_root().unwrap();
    let mut journal = Journal::open(&data, SERVER, LINKED, None).unwrap();
    journal.put(
        &DocId("doc1".to_owned()),
        Some(DocRecord {
            schema: SCHEMA,
            format: "sharejs-text-ot".to_owned(),
            base_text: "a".to_owned(),
            base_raw: None,
            base_version: 1,
            local_text: "ab".to_owned(),
            inflight: None,
            provisional: false,
            path: Some(MAIN.to_owned()),
        }),
    );
    journal.flush().unwrap();
    drop(journal);
    let refused = refuse_overleaf_linked(&collab_paths(), &project, false).unwrap_err();
    assert_eq!(code(refused), "overleaf_linked");
    drop(library);
}

#[test]
fn going_live_on_overleaf_is_refused_for_a_project_shared_on_a_server() {
    let library = TempLibrary::new();
    let project = imported_project();
    let shared = crate::collab::testing::share(&project);
    let refused = tauri::async_runtime::block_on(super::commands::start(
        Arc::new(Quiet),
        &collab_paths(),
        &project,
    ))
    .unwrap_err();
    assert_eq!(code(refused), "collab_shared");
    drop(shared);
    drop(library);
}

#[test]
fn a_stopped_doc_with_unsent_text_keeps_git_sync_refused_and_pause_asks_first() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello\nfirst\n");
        eventually("the first line reaches the server", || {
            rig.mock.doc_text(&doc) == "Hello\nfirst\n"
        })
        .await;
        rig.mock
            .fail_updates(&doc, "Delete component does not match", 2);
        tab.typed(&rig.live, "Hello\nfirst\nkept\n");
        eventually("the doc stops and the tab is told", || {
            tab.inbox
                .lock()
                .unwrap()
                .iter()
                .any(|message| matches!(message, DocMessage::Detached { .. }))
        })
        .await;
        let project_id = rig.project_id.clone();
        assert!(super::git_sync_waits(&project_id).unwrap());
        let _rest = rig.let_go();

        let asked = super::commands::pause(&project_id, false, Duration::from_millis(300))
            .await
            .unwrap();
        assert!(!asked.paused);
        assert_eq!(asked.unsent, vec![MAIN.to_owned()]);
        assert!(super::git_sync_waits(&project_id).unwrap());

        let paused = super::commands::pause(&project_id, true, Duration::from_millis(300))
            .await
            .unwrap();
        assert!(paused.paused);
        assert!(crate::collab::live::session::live_for(&project_id).is_none());
        assert!(super::git_sync_waits(&project_id).unwrap());
    });
    drop(library);
}
