use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};
use oleafly_ot::DocMessage;

use std::sync::Arc;

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::{CollabError, CollabPaths};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::journal::{self, DocRecord, Journal, SCHEMA};
use oleafly_online::realtime::DocId;

use super::account::overleaf_signed_in;
use super::refuse_overleaf_linked;
use super::rig::{eventually, run, session_of, OverleafRig, Place, Quiet};
use crate::collab::live::kept::{KeptFile, KeptKind};
use crate::collab::live::session::{guard, live_for};
use crate::collab::live::UnsentProject;
use crate::collab::testing::TempLibrary;

const MAIN: &str = "main.tex";
const INTRO: &str = "sections/intro.tex";
const STRANDED: &str = "Hello\nfirst\nkept\n";

fn project(main: &str, intro: &str) -> MockProject {
    MockProject::new("live")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, main)
        .doc(INTRO, intro)
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
fn a_faulted_file_detaches_its_tab_and_takes_plain_writes() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let (main, intro) = (rig.doc(MAIN), rig.doc(INTRO));
        let mut tab = rig.open(MAIN);
        let mut other = rig.open(INTRO);
        rig.mock.fail_updates(&main, "update is too large", 1);
        tab.typed(&rig.live, "Hello\nkept\n");
        eventually("the tab is detached as too large", || {
            tab.inbox.lock().unwrap().iter().any(|message| {
                matches!(message, DocMessage::Detached { reason } if reason == "too_large")
            })
        })
        .await;
        let outcome =
            crate::collab::live::write::write_text("overleaf-rig", MAIN, None, "Hello\nplain\n")
                .await
                .unwrap();
        assert!(!outcome.handled);
        other.typed(&rig.live, "Intro\nstill live\n");
        eventually("the other file stays live", || {
            rig.mock.doc_text(&intro) == "Intro\nstill live\n"
        })
        .await;
        assert_eq!(rig.mock.doc_text(&main), "Hello\n");
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
    linked_to(SERVER, LINKED)
}

fn linked_to(server: &str, remote: &str) -> String {
    let project_id = crate::project::create_blank_project("Imported".into()).unwrap();
    let mut meta = crate::project::read_meta(&project_id).unwrap();
    meta.extra.insert(
        "importedFrom".to_owned(),
        serde_json::json!({ "service": "overleaf", "server": server, "projectId": remote }),
    );
    crate::project::write_meta(&project_id, &meta).unwrap();
    project_id
}

fn journal_unsent(server: &str, remote: &str, path: &str) {
    let data = crate::paths::oleafly_root().unwrap();
    let mut journal = Journal::open(&data, server, remote, None).unwrap();
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
            path: Some(path.to_owned()),
        }),
    );
    journal.flush().unwrap();
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
    journal_unsent(SERVER, LINKED, MAIN);
    let refused = refuse_overleaf_linked(&collab_paths(), &project, false).unwrap_err();
    assert_eq!(code(refused), "overleaf_linked");
    drop(library);
}

#[test]
fn unlinking_an_import_only_project_lets_it_share_with_the_card_on() {
    let library = TempLibrary::new();
    let project = imported_project();
    tauri::async_runtime::block_on(super::commands::unlink(&project)).unwrap();
    assert!(refuse_overleaf_linked(&collab_paths(), &project, true).is_ok());
    let meta = crate::project::read_meta(&project).unwrap();
    assert!(!meta.extra.contains_key("importedFrom"));
    drop(library);
}

#[test]
fn unlinking_is_refused_while_overleaf_work_is_unsent() {
    let library = TempLibrary::new();
    let project = imported_project();
    journal_unsent(SERVER, LINKED, MAIN);
    let refused = tauri::async_runtime::block_on(super::commands::unlink(&project)).unwrap_err();
    assert_eq!(code(refused), "overleaf_unsent");
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
        Arc::new(Quiet::default()),
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
        strand_unsent(&rig).await;
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
        assert!(live_for(&project_id).is_none());
        assert!(super::git_sync_waits(&project_id).unwrap());
        assert!(
            super::commands::live_project(&project_id)
                .unwrap()
                .unwrap()
                .paused
        );

        super::commands::resume(&project_id).await.unwrap();
        let resumed = super::commands::live_project(&project_id).unwrap().unwrap();
        assert!(!resumed.paused);
        assert!(!resumed.signed_in);
        assert!(super::git_sync_waits(&project_id).unwrap());
    });
    drop(library);
}

#[test]
fn a_typed_doc_is_marked_pending_until_the_server_confirms_it() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello, pending\n");
        eventually("the server has the typing", || {
            rig.mock.doc_text(&doc) == "Hello, pending\n"
        })
        .await;
        eventually("the doc is confirmed again", || {
            rig.host
                .pending
                .lock()
                .unwrap()
                .last()
                .is_some_and(|last| !last.pending)
        })
        .await;
        let marks: Vec<(String, String, bool)> = rig
            .host
            .pending
            .lock()
            .unwrap()
            .iter()
            .map(|mark| (mark.project_id.clone(), mark.path.clone(), mark.pending))
            .collect();
        assert_eq!(
            marks.first(),
            Some(&("overleaf-rig".to_owned(), MAIN.to_owned(), true))
        );
        assert!(marks.iter().all(|(_, path, _)| path == MAIN));
        rig.finish().await;
    });
}

#[test]
fn project_name_follows_overleaf() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let project_id = rig.project_id.clone();
        rig.mock
            .emit_to_room("projectNameUpdated", &[serde_json::json!("Thesis, final")]);
        eventually("the name follows Overleaf", || {
            crate::project::read_meta(&project_id).is_ok_and(|meta| meta.name == "Thesis, final")
        })
        .await;
        assert!(tokio::fs::metadata(rig.root.join(MAIN))
            .await
            .unwrap()
            .is_file());
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn settings_events_update_the_manifest() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("\\documentclass{article}\n", "\\documentclass{book}\n"),
            &[
                (MAIN, "\\documentclass{article}\n"),
                (INTRO, "\\documentclass{book}\n"),
            ],
            Place::Library,
        )
        .await;
        let project_id = rig.project_id.clone();
        let meta = || crate::project::read_meta(&project_id).unwrap();
        rig.mock
            .emit_to_room("rootDocUpdated", &[serde_json::json!(rig.doc(INTRO))]);
        eventually("the main document follows Overleaf", || {
            meta().main_doc == INTRO
        })
        .await;
        rig.mock
            .emit_to_room("compilerUpdated", &[serde_json::json!("xelatex")]);
        eventually("the compiler follows Overleaf", || {
            meta().tex_flavor.as_deref() == Some("xelatex")
        })
        .await;
        rig.mock
            .emit_to_room("compilerUpdated", &[serde_json::json!("latex")]);
        rig.mock
            .emit_to_room("projectNameUpdated", &[serde_json::json!("Marker")]);
        eventually("a later event is followed", || meta().name == "Marker").await;
        assert_eq!(meta().tex_flavor.as_deref(), Some("xelatex"));
        assert_eq!(meta().engine, crate::config::LATEXMK_ENGINE);
        rig.finish().await;
    });
    drop(library);
}

async fn strand_unsent(rig: &OverleafRig) {
    let doc = rig.doc(MAIN);
    let mut tab = rig.open(MAIN);
    tab.typed(&rig.live, "Hello\nfirst\n");
    eventually("the first line reaches the server", || {
        rig.mock.doc_text(&doc) == "Hello\nfirst\n"
    })
    .await;
    rig.mock
        .fail_updates(&doc, "Delete component does not match", 2);
    tab.typed(&rig.live, STRANDED);
    eventually("the doc stops and the tab is told", || {
        tab.inbox
            .lock()
            .unwrap()
            .iter()
            .any(|message| matches!(message, DocMessage::Detached { .. }))
    })
    .await;
}

fn signed_in_as(base: &str, user: &MockUser) {
    let store = crate::secrets::store().unwrap();
    oleafly_online::session::save(&store, base, &session_of(user)).unwrap();
}

fn stored_session(base: &str) -> bool {
    let store = crate::secrets::store().unwrap();
    oleafly_online::session::load(&store, base)
        .unwrap()
        .is_some()
}

fn journaled_text(base: &str, remote: &str, doc: &str) -> Option<String> {
    let data = crate::paths::oleafly_root().unwrap();
    let file = journal::journal_dir(&data, base, remote)
        .unwrap()
        .join(format!("{doc}.json"));
    let record: DocRecord = serde_json::from_slice(&std::fs::read(file).ok()?).ok()?;
    Some(record.local_text)
}

fn listed(unsent: &[UnsentProject]) -> Vec<(String, Vec<String>)> {
    unsent
        .iter()
        .map(|project| (project.project_id.clone(), project.paths.clone()))
        .collect()
}

#[test]
fn sign_out_lists_unsent_overleaf_docs() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let (base, remote, doc) = (rig.mock.base.clone(), rig.mock.project_id(), rig.doc(MAIN));
        signed_in_as(&base, &rig.mock.user("alice"));
        strand_unsent(&rig).await;
        let other = linked_to(&base, LINKED);
        journal_unsent(&base, LINKED, INTRO);

        let asked =
            crate::overleaf::sign_out_within(base.clone(), false, Duration::from_millis(300))
                .await
                .unwrap();

        assert!(asked.status.signed_in);
        assert_eq!(
            listed(&asked.unsent),
            vec![
                (rig.project_id.clone(), vec![MAIN.to_owned()]),
                (other, vec![INTRO.to_owned()]),
            ]
        );
        assert!(stored_session(&base));
        assert!(live_for(&rig.project_id).is_some());
        assert_eq!(
            journaled_text(&base, &remote, &doc).as_deref(),
            Some(STRANDED)
        );
        let mut journals = vec![
            (remote, vec![MAIN.to_owned()]),
            (LINKED.to_owned(), vec![INTRO.to_owned()]),
        ];
        journals.sort();
        let data = crate::paths::oleafly_root().unwrap();
        assert_eq!(journal::unsent_on(&data, &base), journals);
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn keep_local_copy_stops_live_and_keeps_the_journal() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let base = rig.mock.base.clone();
        signed_in_as(&base, &rig.mock.user("alice"));
        strand_unsent(&rig).await;
        let (project_id, remote, doc) =
            (rig.project_id.clone(), rig.mock.project_id(), rig.doc(MAIN));
        let _rest = rig.let_go();

        let out = crate::overleaf::sign_out_within(base.clone(), true, Duration::from_millis(300))
            .await
            .unwrap();

        assert!(!out.status.signed_in);
        assert_eq!(
            listed(&out.unsent),
            vec![(project_id.clone(), vec![MAIN.to_owned()])]
        );
        assert!(!stored_session(&base));
        assert!(live_for(&project_id).is_none());
        let data = crate::paths::oleafly_root().unwrap();
        assert_eq!(
            journal::unsent_on(&data, &base),
            vec![(remote.clone(), vec![MAIN.to_owned()])]
        );
        assert_eq!(
            journaled_text(&base, &remote, &doc).as_deref(),
            Some(STRANDED)
        );
    });
    drop(library);
}

#[test]
fn sign_out_with_nothing_live_and_nothing_unsent_answers_as_before() {
    let library = TempLibrary::new();
    signed_in_as(SERVER, &MockUser::named("alice"));
    run(async {
        let out =
            crate::overleaf::sign_out_within(SERVER.to_owned(), false, Duration::from_millis(300))
                .await
                .unwrap();
        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({ "server": SERVER, "signedIn": false, "email": null })
        );
    });
    assert!(!stored_session(SERVER));
    drop(library);
}

#[test]
fn sign_out_with_nothing_unsent_stops_live_and_signs_out_without_asking() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let base = rig.mock.base.clone();
        signed_in_as(&base, &rig.mock.user("alice"));
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello\nsent\n");
        eventually("the typing reaches the server", || {
            rig.mock.doc_text(&doc) == "Hello\nsent\n"
        })
        .await;
        let project_id = rig.project_id.clone();
        let _rest = rig.let_go();

        let out = crate::overleaf::sign_out_within(base.clone(), false, Duration::from_secs(2))
            .await
            .unwrap();

        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({ "server": base, "signedIn": false, "email": null })
        );
        assert!(!stored_session(&base));
        assert!(live_for(&project_id).is_none());
    });
    drop(library);
}

#[test]
fn signing_in_again_resumes_a_signed_out_live_session() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello\nonline\n");
        eventually("the first line reaches the server", || {
            rig.mock.doc_text(&doc) == "Hello\nonline\n"
        })
        .await;
        let alice = rig.mock.user("alice");
        let renewed = rig.mock.expire_session("alice");
        let connection = rig
            .mock
            .connections()
            .into_iter()
            .rev()
            .find(|connection| connection.user_id.as_deref() == Some(alice.id.as_str()))
            .unwrap();
        rig.mock.drop_client(&connection.public_id);
        let status = || guard(&rig.live.mirror.status).0.clone();
        eventually("the session waits signed out", || {
            status() == LiveStatus::SignedOut
        })
        .await;
        tab.typed(&rig.live, "Hello\nonline\nsigned out\n");

        overleaf_signed_in(&rig.mock.base, &session_of(&renewed)).unwrap();

        eventually("the typing reaches the server once", || {
            rig.mock.doc_text(&doc) == "Hello\nonline\nsigned out\n"
        })
        .await;
        eventually("the session is online again", || {
            status() == LiveStatus::Online
        })
        .await;
        assert_eq!(rig.mock.doc_text(&doc), "Hello\nonline\nsigned out\n");
        rig.finish().await;
    });
    drop(library);
}

#[test]
fn reconnecting_now_reaches_the_overleaf_session() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        assert!(crate::collab::live::lifecycle::reconnect_now());
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello again\n");
        eventually("typing still reaches the server", || {
            rig.mock.doc_text(&doc) == "Hello again\n"
        })
        .await;
        rig.finish().await;
    });
}

fn ended(rig: &OverleafRig) -> Option<EndReason> {
    match guard(&rig.live.mirror.status).0 {
        LiveStatus::Ended { reason } => Some(reason),
        _ => None,
    }
}

#[test]
fn removal_keeps_unsent_text_as_a_copy_and_lets_the_project_go_local() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let mut tab = rig.open(MAIN);
        rig.mock.hold_updates();
        tab.typed(&rig.live, "Hello\nunsent\n");
        eventually("the edit is sent and still unapplied", || {
            !rig.mock.received("applyOtUpdate").is_empty()
        })
        .await;
        rig.mock.emit_to_room("project:access:revoked", &[]);
        eventually("live ends as removed", || {
            ended(&rig) == Some(EndReason::Removed)
        })
        .await;
        let kept: Vec<KeptFile> = rig
            .host
            .kept
            .lock()
            .unwrap()
            .iter()
            .flat_map(|payload| payload.files.clone())
            .collect();
        assert_eq!(kept.len(), 1, "{kept:?}");
        assert_eq!(
            (kept[0].path.as_str(), kept[0].kind),
            (MAIN, KeptKind::Unsent)
        );
        assert_eq!(rig.read(&kept[0].copy), "Hello\nunsent\n");
        let project_id = rig.project_id.clone();
        rig.finish().await;
        super::commands::unlink(&project_id).await.unwrap();
        let meta = crate::project::read_meta(&project_id).unwrap();
        assert!(!meta.extra.contains_key("importedFrom"));
    });
    drop(library);
}

#[test]
fn a_project_deleted_on_overleaf_ends_as_project_deleted() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        rig.mock
            .emit_to_room("projectRenamedOrDeletedByExternalSource", &[]);
        eventually("live ends as deleted", || {
            ended(&rig) == Some(EndReason::ProjectDeleted)
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn the_role_carries_the_project_flags() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n").deleted_by_external_source(),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        eventually("the role is announced", || {
            !rig.host.roles.lock().unwrap().is_empty()
        })
        .await;
        let role = rig.host.roles.lock().unwrap()[0].clone();
        assert!(role.deleted_externally && !role.restricted, "{role:?}");
        assert_eq!(ended(&rig), None);
        rig.finish().await;
    });
}

#[test]
fn a_reviewers_typing_reaches_the_service_as_tracked_changes() {
    run(async {
        let project = MockProject::new("live")
            .owner(MockUser::named("olga"))
            .member(MockUser::named("alice"), Privilege::Review)
            .doc(MAIN, "Hello\n")
            .doc(INTRO, "Intro\n");
        let rig = OverleafRig::start(project, &[(MAIN, "Hello\n"), (INTRO, "Intro\n")]).await;
        eventually("the reviewer role is announced", || {
            rig.host
                .roles
                .lock()
                .unwrap()
                .last()
                .is_some_and(|role| matches!(role.role, ProjectRole::Reviewer) && role.tracking)
        })
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        tab.typed(&rig.live, "Hello suggested\n");
        eventually("the typing reaches the server as a suggestion", || {
            rig.mock.received("applyOtUpdate").iter().any(|sent| {
                sent.args.first() == Some(&serde_json::json!(doc))
                    && sent
                        .args
                        .get(1)
                        .is_some_and(|update| update["meta"]["tc"].is_string())
            })
        })
        .await;
        eventually("the server has the suggested text", || {
            rig.mock.doc_text(&doc).contains("suggested")
        })
        .await;
        rig.finish().await;
    });
}
