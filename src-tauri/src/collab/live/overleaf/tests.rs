use std::time::Duration;

use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};
use oleafly_ot::DocMessage;

use std::sync::Arc;

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::{CollabError, CollabPaths};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::live::journal::{self, DocRecord, Journal, SCHEMA};
use oleafly_online::realtime::DocId;

use super::account::overleaf_signed_in;
use super::notices::{self, OverleafNotice};
use super::refuse_overleaf_linked;
use super::rig::{eventually, run, session_of, OverleafRig, Place, Quiet};
use crate::collab::live::disk_pass;
use crate::collab::live::host::LiveHost;
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
fn typing_while_the_server_is_down_reaches_the_disk_and_a_compile() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let mut tab = rig.open(MAIN);
        rig.mock.crash();
        eventually("the session sees that the server is down", || {
            matches!(guard(&rig.live.mirror.status).0, LiveStatus::Offline { .. })
        })
        .await;
        let typed = std::time::Instant::now();
        tab.typed(&rig.live, "Hello offline\n");
        eventually("the mirror wrote the offline typing", || {
            rig.read(MAIN) == "Hello offline\n"
        })
        .await;
        assert!(
            typed.elapsed() < Duration::from_secs(2),
            "the offline typing reached the disk after {:?}",
            typed.elapsed()
        );
        tab.typed(&rig.live, "Hello offline, compiled\n");
        let flushed = std::time::Instant::now();
        crate::collab::live::lifecycle::flush("overleaf-rig", false).await;
        assert_eq!(rig.read(MAIN), "Hello offline, compiled\n");
        assert!(
            flushed.elapsed() < Duration::from_secs(1),
            "the compile barrier waited {:?} for a server that is down",
            flushed.elapsed()
        );
        assert_eq!(rig.mock.doc_text(&doc), "Hello\n");
        rig.mock.recover();
        eventually("the server got the offline typing once", || {
            rig.mock.doc_text(&doc) == "Hello offline, compiled\n"
        })
        .await;
        assert_eq!(rig.read(MAIN), "Hello offline, compiled\n");
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

async fn agent_write_after_bob_typed(base: Option<&str>) {
    let rig = OverleafRig::start(
        project("Hello\n", "Intro\n"),
        &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
    )
    .await;
    let doc = rig.doc(MAIN);
    crate::collab::live::write::note_read(&rig.project_id, MAIN, "Hello\n");
    let mut bob = rig.mock.peer("bob");
    bob.join(&doc);
    bob.type_at(&doc, 0, "Hi ");
    eventually("bob's edit reaches disk", || rig.read(MAIN) == "Hi Hello\n").await;
    let outcome =
        crate::collab::live::write::write_text(&rig.project_id, MAIN, base, "Hello\nthere\n")
            .await
            .unwrap();
    assert!(outcome.handled);
    eventually("both edits reach the server", || {
        rig.mock.doc_text(&doc) == "Hi Hello\nthere\n"
    })
    .await;
    assert_eq!(rig.read(MAIN), "Hi Hello\nthere\n");
    rig.finish().await;
}

#[test]
fn an_mcp_write_after_a_native_read_keeps_a_coauthor_edit() {
    run(agent_write_after_bob_typed(None));
}

#[test]
fn an_agent_write_with_its_own_base_keeps_that_base() {
    run(agent_write_after_bob_typed(Some("Hello\n")));
}

#[test]
fn an_agent_can_write_back_the_text_it_replaced() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        crate::collab::live::write::note_read(&rig.project_id, MAIN, "Hello\n");
        for text in ["Hello\nthere\n", "Hello\n"] {
            let outcome = crate::collab::live::write::write_text(&rig.project_id, MAIN, None, text)
                .await
                .unwrap();
            assert!(outcome.handled);
            eventually("the write reaches the server", || {
                rig.mock.doc_text(&doc) == text
            })
            .await;
            assert_eq!(rig.read(MAIN), text);
        }
        rig.finish().await;
    });
}

const SERVER: &str = "https://www.overleaf.com";
const LINKED: &str = "6af963ebc9037022065bb53f";

pub(super) fn imported_project() -> String {
    linked_to(SERVER, LINKED)
}

pub(super) fn linked_to(server: &str, remote: &str) -> String {
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
            queued: Vec::new(),
        }),
    );
    journal.flush().unwrap();
}

pub(super) fn collab_paths() -> CollabPaths {
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
fn a_project_live_on_the_service_refuses_sharing_whatever_the_page_says() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let refused = refuse_overleaf_linked(&collab_paths(), &rig.project_id, false).unwrap_err();
        assert_eq!(code(refused), "overleaf_linked");
        rig.finish().await;
    });
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

pub(super) fn signed_in_as(base: &str, user: &MockUser) {
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
            crate::overleaf::sign_out_within(base.clone(), None, false, Duration::from_millis(300))
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
        assert_eq!(journal::unsent_on(&data, &base, None), journals);
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

        let out =
            crate::overleaf::sign_out_within(base.clone(), None, true, Duration::from_millis(300))
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
            journal::unsent_on(&data, &base, None),
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
        let out = crate::overleaf::sign_out_within(
            SERVER.to_owned(),
            None,
            false,
            Duration::from_millis(300),
        )
        .await
        .unwrap();
        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({
                "server": SERVER, "signedIn": false, "email": null, "userId": null, "accounts": []
            })
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

        let out =
            crate::overleaf::sign_out_within(base.clone(), None, false, Duration::from_secs(2))
                .await
                .unwrap();

        assert_eq!(
            serde_json::to_value(&out).unwrap(),
            serde_json::json!({
                "server": base, "signedIn": false, "email": null, "userId": null, "accounts": []
            })
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

async fn removal_finds_the_unsent_text_in_the_file(while_recording: bool) {
    let rig = OverleafRig::start_at(
        project("Hello\n", "Intro\n"),
        &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        Place::Library,
    )
    .await;
    let mut tab = rig.open(MAIN);
    rig.mock.hold_updates();
    if while_recording {
        disk_pass::pause_at(
            &disk_pass::RECORD_LATE,
            &rig.root,
            Some(Duration::from_secs(10)),
        );
    }
    tab.typed(&rig.live, "Hello\nunsent\n");
    eventually("the edit is sent and still unapplied", || {
        !rig.mock.received("applyOtUpdate").is_empty()
    })
    .await;
    eventually("the unsent text is in the file", || {
        rig.read(MAIN) == "Hello\nunsent\n"
    })
    .await;
    if while_recording {
        eventually("the writer has not recorded the text yet", || {
            disk_pass::writer_paused(&rig.root)
        })
        .await;
    }
    rig.mock.emit_to_room("project:access:revoked", &[]);
    eventually("live ends as removed", || {
        ended(&rig) == Some(EndReason::Removed)
    })
    .await;
    disk_pass::pause_at(&disk_pass::RECORD_LATE, &rig.root, None);
    let kept = || -> Vec<KeptFile> {
        rig.host
            .kept
            .lock()
            .unwrap()
            .iter()
            .flat_map(|payload| payload.files.clone())
            .collect()
    };
    eventually("the unsent change is announced", || !kept().is_empty()).await;
    let kept = kept();
    assert_eq!(kept.len(), 1, "{kept:?}");
    assert_eq!(
        (kept[0].path.as_str(), kept[0].kind, kept[0].copy.as_deref()),
        (MAIN, KeptKind::Unsent, None)
    );
    assert_eq!(rig.read(MAIN), "Hello\nunsent\n");
    let project_id = rig.project_id.clone();
    rig.finish().await;
    super::commands::unlink(&project_id).await.unwrap();
    let meta = crate::project::read_meta(&project_id).unwrap();
    assert!(!meta.extra.contains_key("importedFrom"));
}

#[test]
fn removal_says_unsent_text_stayed_in_the_file_and_lets_the_project_go_local() {
    let library = TempLibrary::new();
    run(removal_finds_the_unsent_text_in_the_file(false));
    drop(library);
}

#[test]
fn removal_finds_the_unsent_text_in_the_file_before_the_writer_records_it() {
    let library = TempLibrary::new();
    run(removal_finds_the_unsent_text_in_the_file(true));
    drop(library);
}

#[test]
fn unlinking_a_project_whose_import_names_a_path_keeps_the_project_folder() {
    let library = TempLibrary::new();
    let project_id = linked_to(SERVER, "../../projects");
    let data = crate::paths::oleafly_root().unwrap();
    std::fs::create_dir_all(
        data.join("overleaf-mirror")
            .join(journal::origin_dir(SERVER).unwrap()),
    )
    .unwrap();
    let root = crate::paths::project_dir(&project_id).unwrap();
    run(async { super::commands::unlink(&project_id).await.unwrap() });
    assert!(root.join("project.json").is_file());
    let meta = crate::project::read_meta(&project_id).unwrap();
    assert!(!meta.extra.contains_key("importedFrom"));
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
        rig.mock.delete_project();
        let _tab = rig.open(INTRO);
        eventually("live ends as deleted", || {
            ended(&rig) == Some(EndReason::ProjectDeleted)
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn a_project_removed_from_its_linked_source_stays_live_and_says_so() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        eventually("the role is announced", || {
            !rig.host.roles.lock().unwrap().is_empty()
        })
        .await;
        rig.mock
            .emit_to_room("projectRenamedOrDeletedByExternalSource", &[]);
        eventually("the role says the project left its linked source", || {
            rig.host
                .roles
                .lock()
                .unwrap()
                .last()
                .is_some_and(|role| role.deleted_externally)
        })
        .await;
        assert_eq!(ended(&rig), None);
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

#[test]
fn a_coauthors_position_reaches_presence_with_its_path_and_offset() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let _tab = rig.open(MAIN);
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.emit(
            "clientTracking.updatePosition",
            vec![serde_json::json!({ "row": 0, "column": 3, "doc_id": doc })],
        );
        let bob_id = bob.public_id.clone();
        eventually("bob's caret reaches presence", || {
            rig.host.presence.lock().unwrap().iter().any(|payload| {
                payload.device_id == bob_id
                    && payload.path.as_deref() == Some(MAIN)
                    && payload.cursor == Some(3)
            })
        })
        .await;
        let shown = rig
            .host
            .presence
            .lock()
            .unwrap()
            .iter()
            .find(|payload| payload.device_id == bob_id)
            .cloned()
            .unwrap();
        assert_eq!(shown.account_id, rig.mock.user("bob").id);
        assert_eq!(
            shown.person.and_then(|person| person.name).as_deref(),
            Some("Bob Tester")
        );
        let members = rig.live.members();
        let bob_member = members
            .iter()
            .find(|member| member.person.account_id == rig.mock.user("bob").id)
            .unwrap();
        assert_eq!(bob_member.person.display_name, "Bob Tester");
        assert!(matches!(bob_member.role, ProjectRole::Editor));
        bob.drop_connection();
        eventually("bob leaves", || {
            rig.host.left.lock().unwrap().contains(&bob_id)
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn our_caret_reaches_the_service() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let _tab = rig.open(MAIN);
        eventually("the doc is joined", || {
            rig.mock
                .received("joinDoc")
                .iter()
                .any(|sent| sent.args.first() == Some(&serde_json::json!(doc)))
        })
        .await;
        crate::collab::live::editor::presence_set(
            &rig.project_id,
            Some(MAIN.to_owned()),
            Some(4),
            Some(1),
        );
        eventually("the position reaches the server", || {
            rig.mock
                .received("clientTracking.updatePosition")
                .iter()
                .any(|sent| {
                    sent.args[0] == serde_json::json!({ "row": 0, "column": 4, "doc_id": doc })
                })
        })
        .await;
        rig.finish().await;
    });
}

fn noticed(rig: &OverleafRig, notice: &OverleafNotice) -> bool {
    rig.host
        .notices
        .lock()
        .unwrap()
        .iter()
        .any(|payload| payload.notice == *notice)
}

fn too_large() -> OverleafNotice {
    OverleafNotice::Fault {
        path: MAIN.to_owned(),
        reason: "too_large".to_owned(),
    }
}

async fn faulted(rig: &OverleafRig) {
    let doc = rig.doc(MAIN);
    let mut tab = rig.open(MAIN);
    rig.mock.fail_updates(&doc, "update is too large", 1);
    tab.typed(&rig.live, "Hello\nkept\n");
    eventually("the fault is noticed", || noticed(rig, &too_large())).await;
}

#[test]
fn a_fault_is_noticed_and_trying_again_sends_the_trimmed_text() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        faulted(&rig).await;
        eventually("the refused text reaches the disk", || {
            rig.read(MAIN) == "Hello\nkept\n"
        })
        .await;
        rig.edit(MAIN, "Hello\ntrimmed\n");
        notices::retry(&rig.project_id, MAIN).unwrap();
        let doc = rig.doc(MAIN);
        eventually("the trimmed text goes live", || {
            rig.mock.doc_text(&doc) == "Hello\ntrimmed\n"
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn keeping_a_copy_writes_it_beside_the_file_and_reloads_the_server_text() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        faulted(&rig).await;
        eventually("the refused text reaches the disk", || {
            rig.read(MAIN) == "Hello\nkept\n"
        })
        .await;
        rig.edit(MAIN, "Hello\nmine\n");
        notices::keep_copy(&rig.project_id, MAIN).unwrap();
        eventually("the copy is written and the file reloads", || {
            let kept = std::fs::read_dir(&rig.root)
                .unwrap()
                .filter_map(Result::ok)
                .any(|entry| {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    name != MAIN && name.starts_with("main") && rig.read(&name) == "Hello\nmine\n"
                });
            kept && rig.read(MAIN) == "Hello\n"
        })
        .await;
        assert!(notices::retry(&rig.project_id, MAIN).is_err());
        rig.finish().await;
    });
}

#[test]
fn an_external_update_is_noticed() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(MAIN);
        let _tab = rig.open(MAIN);
        eventually("the doc is joined", || {
            rig.mock
                .connections()
                .iter()
                .any(|connection| connection.joined.contains(&doc))
        })
        .await;
        rig.mock.external_edit(&doc, 0, "Restored ");
        let external = OverleafNotice::External {
            path: MAIN.to_owned(),
        };
        eventually("the external update is noticed", || {
            noticed(&rig, &external)
        })
        .await;
        eventually("the restored text reaches disk", || {
            rig.read(MAIN) == "Restored Hello\n"
        })
        .await;
        rig.finish().await;
    });
}

fn journal_dir_of(base: &str, remote: &str) -> std::path::PathBuf {
    journal::journal_dir(&crate::paths::oleafly_root().unwrap(), base, remote).unwrap()
}

fn mirror_dir_of(base: &str, remote: &str, project_id: &str) -> std::path::PathBuf {
    let link = crate::overleaf::OverleafLink {
        server: base.to_owned(),
        project_id: remote.to_owned(),
        user_id: None,
    };
    super::mirror_dir(&crate::paths::oleafly_root().unwrap(), &link, project_id).unwrap()
}

fn live_lock(project_id: &str) -> std::path::PathBuf {
    crate::paths::project_dir(project_id)
        .unwrap()
        .join(".oleafly")
        .join("online")
        .join("live.lock")
}

async fn within<T>(what: &str, wait: Duration, work: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(wait, work)
        .await
        .unwrap_or_else(|_| panic!("timed out waiting until {what}"))
}

#[test]
fn a_session_that_ends_by_itself_leaves_and_trying_again_starts_afresh() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        signed_in_as(&rig.mock.base, &rig.mock.user("alice"));
        let project_id = rig.project_id.clone();
        let host: Arc<dyn LiveHost> = Arc::clone(&rig.host) as Arc<dyn LiveHost>;
        rig.mock.emit_to_room("project:access:revoked", &[]);
        eventually("live ends as removed", || {
            ended(&rig) == Some(EndReason::Removed)
        })
        .await;
        let rest = rig.let_go();
        eventually("the ended session leaves", || {
            live_for(&project_id).is_none()
        })
        .await;

        within(
            "trying again goes live",
            Duration::from_secs(15),
            super::commands::start(host, &collab_paths(), &project_id),
        )
        .await
        .unwrap();
        let again = live_for(&project_id)
            .and_then(|live| live.overleaf().cloned())
            .expect("a fresh session");
        assert!(!again.ended());
        drop(again);
        crate::collab::live::stop(&project_id).await;
        drop(rest);
    });
    drop(library);
}

async fn start_on_a_stalled_server(
    mock: &MockOverleaf,
) -> (
    String,
    tauri::async_runtime::JoinHandle<Result<crate::collab::live::payloads::LiveInfo, CollabError>>,
) {
    let project_id = linked_to(&mock.base, &mock.project_id());
    signed_in_as(&mock.base, &mock.user("alice"));
    mock.stall();
    let starting = {
        let id = project_id.clone();
        tauri::async_runtime::spawn(async move {
            super::commands::start(Arc::new(Quiet::default()), &collab_paths(), &id).await
        })
    };
    let handshake = format!("/socket.io/1/?projectId={}", mock.project_id());
    eventually("the start waits on the stalled server", || {
        !mock.requests(&handshake).is_empty()
    })
    .await;
    (project_id, starting)
}

async fn never_goes_live(mock: &MockOverleaf, project_id: &str) {
    mock.resume();
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(live_for(project_id).is_none());
}

#[test]
fn unlinking_during_a_stalled_first_connect_cancels_it_and_removes_what_it_kept() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(project("Hello\n", "Intro\n")).await;
        let (project_id, starting) = start_on_a_stalled_server(&mock).await;
        assert!(live_lock(&project_id).is_file());

        super::commands::unlink(&project_id).await.unwrap();

        let started = within("the start gives up", Duration::from_secs(5), starting)
            .await
            .unwrap();
        assert_eq!(code(started.unwrap_err()), "not_found");
        never_goes_live(&mock, &project_id).await;
        let meta = crate::project::read_meta(&project_id).unwrap();
        assert!(!meta.extra.contains_key("importedFrom"));
        assert!(!journal_dir_of(&mock.base, &mock.project_id()).exists());
        assert!(!mirror_dir_of(&mock.base, &mock.project_id(), &project_id).exists());
        assert!(!live_lock(&project_id).exists());
    });
    drop(library);
}

#[test]
fn signing_out_during_a_stalled_first_connect_cancels_it() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(project("Hello\n", "Intro\n")).await;
        let (project_id, starting) = start_on_a_stalled_server(&mock).await;

        let out = crate::overleaf::sign_out_within(
            mock.base.clone(),
            None,
            false,
            Duration::from_millis(300),
        )
        .await
        .unwrap();

        assert!(!out.status.signed_in);
        let started = within("the start gives up", Duration::from_secs(5), starting)
            .await
            .unwrap();
        assert!(started.is_err());
        never_goes_live(&mock, &project_id).await;
        assert!(!stored_session(&mock.base));
    });
    drop(library);
}

#[test]
fn unlinking_keeps_a_journal_another_linked_project_still_uses() {
    let library = TempLibrary::new();
    let first = imported_project();
    let second = imported_project();
    let data = crate::paths::oleafly_root().unwrap();
    Journal::open(&data, SERVER, LINKED, None)
        .unwrap()
        .flush()
        .unwrap();
    let journal = journal_dir_of(SERVER, LINKED);
    assert!(journal.is_dir());
    tauri::async_runtime::block_on(super::commands::unlink(&first)).unwrap();
    assert!(journal.is_dir());
    tauri::async_runtime::block_on(super::commands::unlink(&second)).unwrap();
    assert!(!journal.exists());
    drop(library);
}

#[test]
fn recycling_a_linked_project_removes_what_it_kept_for_overleaf() {
    let library = TempLibrary::new();
    let project_id = imported_project();
    let data = crate::paths::oleafly_root().unwrap();
    let root = crate::paths::project_dir(&project_id).unwrap();
    drop(Journal::open(&data, SERVER, LINKED, Some(&root)).unwrap());
    let mirror = mirror_dir_of(SERVER, LINKED, &project_id);
    std::fs::create_dir_all(&mirror).unwrap();
    std::fs::write(mirror.join(super::IMPORT_BASES), b"{}").unwrap();
    assert!(live_lock(&project_id).is_file());

    tauri::async_runtime::block_on(crate::project::recycle_project_synchronized(
        &crate::state::AppState::default(),
        project_id.clone(),
    ))
    .unwrap();

    assert!(!root.exists());
    assert!(!journal_dir_of(SERVER, LINKED).exists());
    assert!(!mirror.exists());
    drop(library);
}

#[test]
fn stopping_detaches_open_tabs_and_forgets_what_the_editor_read() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let tab = rig.open(MAIN);
        crate::collab::live::write::note_read(&rig.project_id, MAIN, "Hello\n");
        let project_id = rig.project_id.clone();
        assert!(crate::collab::live::write::reads_kept(&project_id));

        rig.finish().await;

        assert!(!crate::collab::live::write::reads_kept(&project_id));
        assert!(tab.inbox.lock().unwrap().iter().any(|message| matches!(
            message,
            DocMessage::Detached { reason } if reason == "stopped"
        )));
    });
}

fn slow_writes(root: &std::path::Path, late: Option<Duration>) {
    disk_pass::pause_at(&disk_pass::WRITE_LATE, root, late);
}

#[test]
fn a_slow_file_write_holds_up_neither_the_disk_text_nor_paths() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(INTRO);
        slow_writes(&rig.root, Some(Duration::from_millis(1_500)));
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, "New ");
        eventually("the writer is inside a slow write", || {
            disk_pass::writer_paused(&rig.root)
        })
        .await;

        let started = std::time::Instant::now();
        let text = rig.live.mirror.mirrored_text(MAIN);
        let path = rig.live.mirror.path_of(&DocId(doc.clone()));
        let waited = started.elapsed();
        slow_writes(&rig.root, None);

        assert!(waited < Duration::from_millis(500), "{waited:?}");
        assert_eq!(text.as_deref(), Some("Hello\n"));
        assert_eq!(path.as_deref(), Some(INTRO));
        eventually("the edit lands on disk", || {
            rig.read(INTRO) == "New Intro\n"
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn quitting_writes_what_arrived_before_it_stops_the_session() {
    run(async {
        let rig = OverleafRig::start(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
        )
        .await;
        let doc = rig.doc(INTRO);
        slow_writes(&rig.root, Some(Duration::from_millis(600)));
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, "Late ");
        eventually("the writer is inside a slow write", || {
            disk_pass::writer_paused(&rig.root)
        })
        .await;

        rig.live.quit(Duration::from_secs(5)).await;
        slow_writes(&rig.root, None);

        assert_eq!(rig.read(INTRO), "Late Intro\n");
        let order = rig.host.order.lock().unwrap().clone();
        let written = order
            .iter()
            .position(|event| event.starts_with("changed") && event.contains(INTRO))
            .expect("the edit is written");
        let stopped = order
            .iter()
            .position(|event| event.starts_with("status Ended"))
            .expect("the session stops");
        assert!(written < stopped, "{order:?}");
        rig.finish().await;
    });
}

#[test]
fn a_rename_waiting_for_the_project_lock_holds_up_no_typing() {
    let library = TempLibrary::new();
    run(async {
        let rig = OverleafRig::start_at(
            project("Hello\n", "Intro\n"),
            &[(MAIN, "Hello\n"), (INTRO, "Intro\n")],
            Place::Library,
        )
        .await;
        let project_id = rig.project_id.clone();
        let held = crate::worktree_lock::ProjectWorktreeLock::exclusive(&project_id).unwrap();
        rig.mock
            .emit_to_room("projectNameUpdated", &[serde_json::json!("Held name")]);
        let doc = rig.doc(INTRO);
        let mut bob = rig.mock.peer("bob");
        bob.join(&doc);
        bob.type_at(&doc, 0, "Typed ");

        within(
            "the typing lands while the rename waits",
            Duration::from_secs(4),
            async {
                while rig.read(INTRO) != "Typed Intro\n" {
                    tokio::time::sleep(Duration::from_millis(20)).await;
                }
            },
        )
        .await;
        let name = || crate::project::read_meta(&project_id).map(|meta| meta.name);
        assert_ne!(name().as_deref(), Ok("Held name"));
        drop(held);
        eventually("the rename lands once the lock is free", || {
            name().as_deref() == Ok("Held name")
        })
        .await;
        rig.finish().await;
    });
    drop(library);
}
