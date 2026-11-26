use std::time::Duration;

use oleafly_collab::CollabError;
use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};
use oleafly_ot::DocMessage;

use super::rig::{eventually, run, FirstStart, OverleafRig, Place};

const MAIN: &str = "main.tex";
const NOTES: &str = "notes.tex";
const DISK: &[(&str, &str)] = &[(MAIN, "First\n"), (NOTES, "Notes\n")];
const DAY_MS: i64 = 24 * 60 * 60 * 1000;

fn project() -> MockProject {
    MockProject::new("history")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("carol"), Privilege::Review)
        .member(MockUser::named("dave"), Privilege::ReadOnly)
        .doc(MAIN, "First\n")
        .doc(NOTES, "Notes\n")
}

async fn as_user(name: &str) -> OverleafRig {
    OverleafRig::start_full(
        project(),
        DISK,
        Place::Scratch,
        FirstStart {
            imported: DISK,
            ..FirstStart::default()
        },
        name,
    )
    .await
}

fn code(error: CollabError) -> String {
    match error {
        CollabError::Api { code, .. } => code,
        other => format!("{other:?}"),
    }
}

fn now() -> i64 {
    crate::collab::commands::now_ms()
}

fn bob_edits(rig: &OverleafRig, path: &str, text: &str) {
    rig.mock.external_edit(&rig.doc(path), 0, text);
    rig.mock.record_version("bob", path);
}

#[test]
fn history_lists_overleaf_versions_with_local_paths_and_authors() {
    run(async {
        let rig = as_user("alice").await;
        bob_edits(&rig, NOTES, "More ");
        bob_edits(&rig, MAIN, "Second ");
        let page = rig.live.history_list(None, 50, now()).await.unwrap();
        assert!(!page.limited);
        assert_eq!(
            page.entries
                .iter()
                .map(|entry| entry.id.as_str())
                .collect::<Vec<_>>(),
            ["2", "1"]
        );
        assert_eq!(page.entries[0].files, [MAIN]);
        assert_eq!(page.entries[0].authors, [rig.mock.user("bob").id]);
        let at_one = rig.live.history_file("1", NOTES).await.unwrap();
        assert_eq!(at_one.text.as_deref(), Some("More Notes\n"));
        let missing = rig.live.history_file("1", "gone.tex").await.unwrap();
        assert!(!missing.existed && missing.text.is_none());
        assert_eq!(
            rig.live.history_changed("0", "2").await.unwrap(),
            [MAIN, NOTES]
        );
        assert_eq!(
            code(rig.live.history_file("x", MAIN).await.unwrap_err()),
            "history_unavailable"
        );
        rig.finish().await;
    });
}

#[test]
fn a_free_plan_stops_after_the_first_day_old_version() {
    run(async {
        let rig = as_user("alice").await;
        rig.mock.configure(|config| config.versioning = false);
        let joined = rig.live.session.details().public_id.unwrap();
        rig.mock.disconnect(&joined);
        for round in 0..3 {
            bob_edits(&rig, NOTES, &format!("{round} "));
        }
        eventually("the plan is read from the join", || {
            rig.live.history_status().limited
        })
        .await;
        let later = rig
            .live
            .history_list(None, 50, now() + 2 * DAY_MS)
            .await
            .unwrap();
        assert!(later.limited);
        assert_eq!(later.entries.len(), 1);
        assert_eq!(later.next_before, None);
        let today = rig.live.history_list(None, 2, now()).await.unwrap();
        assert!(!today.limited);
        assert!(today.next_before.is_some());
        rig.finish().await;
    });
}

#[test]
fn renaming_a_version_adds_the_new_name_before_removing_the_old() {
    run(async {
        let rig = as_user("alice").await;
        bob_edits(&rig, MAIN, "x");
        rig.live.history_name("1", "Draft").await.unwrap();
        let page = rig.live.history_list(None, 50, now()).await.unwrap();
        assert_eq!(page.entries[0].name.as_deref(), Some("Draft"));
        let label = page.entries[0].version_id.clone().unwrap();
        rig.live.history_name(&label, "Submitted").await.unwrap();
        let labels: Vec<String> = rig
            .mock
            .requests(&format!("/project/{}/labels", rig.mock.project_id()))
            .into_iter()
            .filter(|request| request.method != "GET")
            .map(|request| request.method)
            .collect();
        assert_eq!(labels, ["POST", "POST", "DELETE"]);
        let page = rig.live.history_list(None, 50, now()).await.unwrap();
        assert_eq!(page.entries[0].name.as_deref(), Some("Submitted"));
        let renamed = page.entries[0].version_id.clone().unwrap();
        rig.live.history_unname(&renamed).await.unwrap();
        let page = rig.live.history_list(None, 50, now()).await.unwrap();
        assert_eq!(page.entries[0].name, None);
        assert_eq!(
            code(rig.live.history_name("1", "   ").await.unwrap_err()),
            "empty"
        );
        rig.finish().await;
    });
}

#[test]
fn reviewers_name_versions_but_cannot_restore_and_viewers_do_neither() {
    run(async {
        let carol = as_user("carol").await;
        eventually("the role is known", || carol.live.history_status().name).await;
        bob_edits(&carol, MAIN, "x");
        let status = carol.live.history_status();
        assert!(status.available && status.name && !status.restore && status.download);
        carol.live.history_name("1", "Carol's").await.unwrap();
        assert_eq!(
            code(carol.live.history_restore("0", None).await.unwrap_err()),
            "forbidden"
        );
        carol.finish().await;

        let dave = as_user("dave").await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        let status = dave.live.history_status();
        assert!(status.available && !status.name && !status.restore);
        assert_eq!(
            code(dave.live.history_name("1", "No").await.unwrap_err()),
            "forbidden"
        );
        dave.finish().await;
    });
}

#[test]
fn restoring_a_file_replaces_the_open_doc_through_the_live_session_only() {
    run(async {
        let rig = as_user("alice").await;
        rig.mock.configure(|config| {
            config.restore_gap = Duration::from_millis(2500);
            config.ranges_support = true;
        });
        bob_edits(&rig, MAIN, "Changed ");
        eventually("the edit reached the disk", || {
            rig.read(MAIN) == "Changed First\n"
        })
        .await;
        let tab = rig.open(MAIN);
        let sent = rig.mock.received("applyOtUpdate").len();
        rig.live
            .history_restore("0", Some(vec![MAIN.to_owned()]))
            .await
            .unwrap();
        eventually("the restored text is on disk", || {
            rig.read(MAIN) == "First\n"
        })
        .await;
        eventually("the open tab is told", || {
            tab.inbox.lock().unwrap().iter().any(|message| {
                matches!(message, DocMessage::Detached { reason } if reason == "replaced")
            })
        })
        .await;
        assert_ne!(rig.doc(MAIN), tab.file_id);
        assert_eq!(rig.mock.received("applyOtUpdate").len(), sent);
        assert!(rig
            .host
            .removed
            .lock()
            .unwrap()
            .iter()
            .all(|removed| removed.files.iter().all(|file| file.path != MAIN)));
        rig.finish().await;
    });
}

#[test]
fn a_server_without_ranges_support_says_it_cannot_restore_over_a_file() {
    run(async {
        let rig = as_user("alice").await;
        bob_edits(&rig, MAIN, "Changed ");
        let refused = rig
            .live
            .history_restore("0", Some(vec![MAIN.to_owned()]))
            .await
            .unwrap_err();
        assert_eq!(code(refused), "restore_off_server");
        rig.finish().await;
    });
}

#[test]
fn a_restore_waits_for_unsent_edits_and_refuses_while_they_stay_unsent() {
    run(async {
        let rig = as_user("alice").await;
        let mut tab = rig.open(MAIN);
        rig.mock.hold_updates();
        tab.typed(&rig.live, "First\nmine\n");
        let refused = rig
            .live
            .history_restore("0", Some(vec![MAIN.to_owned()]))
            .await
            .unwrap_err();
        assert_eq!(code(refused), "overleaf_unsent");
        rig.mock.release_updates();
        rig.finish().await;
    });
}

#[test]
fn a_version_zip_is_checked_then_committed_and_a_failure_leaves_nothing() {
    run(async {
        let rig = as_user("alice").await;
        let out = tempfile::tempdir().unwrap();
        let dest = out.path().join("version.zip");
        let dest_text = dest.to_string_lossy().into_owned();
        assert_eq!(
            code(
                rig.live
                    .history_zip("0", dest_text.clone())
                    .await
                    .unwrap_err()
            ),
            "forbidden",
            "a path the save dialog didn't pick is refused"
        );
        crate::path_grants::grant(crate::path_grants::Access::Save, &dest);
        let size = rig.live.history_zip("0", dest_text.clone()).await.unwrap();
        assert_eq!(std::fs::metadata(&dest).unwrap().len(), size);
        let mut archive = zip::ZipArchive::new(std::fs::File::open(&dest).unwrap()).unwrap();
        assert!(archive.by_name(MAIN).is_ok());
        std::fs::remove_file(&dest).unwrap();
        rig.mock.configure(|config| config.zip_status = 402);
        assert_eq!(
            code(rig.live.history_zip("0", dest_text).await.unwrap_err()),
            "history_plan_limit"
        );
        let left: Vec<_> = std::fs::read_dir(out.path()).unwrap().collect();
        assert!(left.is_empty(), "{left:?}");
        rig.finish().await;
    });
}
