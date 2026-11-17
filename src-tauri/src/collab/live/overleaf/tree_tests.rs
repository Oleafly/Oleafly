use std::sync::Arc;
use std::time::Duration;

use oleafly_online::client::Http;
use oleafly_online::live::rest::TreeRest;
use oleafly_online::realtime::events::EntityId;
use oleafly_online::realtime::tree::NodeKind;
use oleafly_online::realtime::ProjectPage;
use oleafly_online::session::SessionHandle;
use oleafly_online::test_support::mock_overleaf::{MockProject, MockUser, Privilege};
use oleafly_ot::DocMessage;

use super::rig::{eventually, run, session_of, OverleafRig};
use super::TreeNoticeKind;
use crate::collab::disk::sha256_hex;
use crate::collab::live::kept::KeptKind;

const MAIN: &str = "main.tex";
const NOTES: &str = "notes.tex";
const INTRO: &str = "sections/intro.tex";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nplot";
const MINE: &[u8] = b"\x89PNG\r\n\x1a\n\0mine";
const DISK: &[(&str, &str)] = &[(MAIN, "Hello\n"), (NOTES, "Notes\n"), (INTRO, "Intro\n")];

fn project() -> MockProject {
    MockProject::new("tree")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .member(MockUser::named("vera"), Privilege::ReadOnly)
        .doc(MAIN, "Hello\n")
        .doc(NOTES, "Notes\n")
        .doc(INTRO, "Intro\n")
}

struct Bob {
    rest: TreeRest,
    session: SessionHandle,
    root: EntityId,
}

async fn bob(rig: &OverleafRig) -> Bob {
    let http = Http::new(&rig.mock.base, "Oleafly/test").unwrap();
    let session = SessionHandle::new(&rig.mock.base, session_of(&rig.mock.user("bob")), None);
    let page = ProjectPage::load(&http, &session, &rig.mock.project_id(), false)
        .await
        .unwrap();
    Bob {
        rest: TreeRest::new(http, Arc::new(page), &rig.mock.project_id()),
        session,
        root: EntityId(rig.mock.root_folder_id()),
    }
}

fn entity(rig: &OverleafRig, path: &str) -> EntityId {
    EntityId(rig.mock.entity_id(path).unwrap())
}

async fn on_disk(rig: &OverleafRig, path: &str) -> Option<Vec<u8>> {
    tokio::fs::read(rig.root.join(path)).await.ok()
}

async fn put(rig: &OverleafRig, path: &str, bytes: &[u8]) {
    let target = rig.root.join(path);
    tokio::fs::create_dir_all(target.parent().unwrap())
        .await
        .unwrap();
    tokio::fs::write(target, bytes).await.unwrap();
}

async fn import(rig: &OverleafRig, paths: &[&str]) {
    rig.live
        .import_paths(Some(paths.iter().map(|path| (*path).to_owned()).collect()))
        .await
        .unwrap();
}

fn calls(rig: &OverleafRig, method: &str, route: &str) -> usize {
    let wanted = format!("/project/{}{route}", rig.mock.project_id());
    rig.mock
        .requests(&wanted)
        .into_iter()
        .filter(|request| request.method == method)
        .filter(|request| request.path.split('?').next() == Some(wanted.as_str()))
        .count()
}

fn told(rig: &OverleafRig) -> Vec<TreeNoticeKind> {
    rig.host
        .tree
        .lock()
        .unwrap()
        .iter()
        .map(|notice| notice.kind.clone())
        .collect()
}

async fn ready(rig: OverleafRig) -> OverleafRig {
    settle(&rig).await;
    rig
}

async fn settle(rig: &OverleafRig) {
    rig.live.flush().await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    rig.live.flush().await;
}

async fn disk_matches(rig: &OverleafRig, path: &str, wanted: &[u8]) {
    let started = std::time::Instant::now();
    loop {
        if on_disk(rig, path).await.as_deref() == Some(wanted) {
            return;
        }
        assert!(
            started.elapsed() < super::rig::WAIT,
            "{path} never matched on disk"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

async fn disk_gone(rig: &OverleafRig, path: &str) {
    let started = std::time::Instant::now();
    while tokio::fs::symlink_metadata(rig.root.join(path))
        .await
        .is_ok()
    {
        assert!(
            started.elapsed() < super::rig::WAIT,
            "{path} stayed on disk"
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn removed_copy(rig: &OverleafRig, path: &str) -> String {
    rig.host
        .removed
        .lock()
        .unwrap()
        .iter()
        .flat_map(|payload| payload.files.clone())
        .find(|file| file.path == path)
        .and_then(|file| file.copy)
        .unwrap()
}

fn detached(tab: &super::rig::Tab) -> Vec<String> {
    tab.inbox
        .lock()
        .unwrap()
        .iter()
        .filter_map(|message| match message {
            DocMessage::Detached { reason } => Some(reason.clone()),
            _ => None,
        })
        .collect()
}

#[test]
fn a_new_doc_from_the_web_is_joined_and_written() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let bob = bob(&rig).await;
        let id = bob
            .rest
            .create_doc(&bob.session, &bob.root, "appendix.tex")
            .await
            .unwrap();
        disk_matches(&rig, "appendix.tex", b"").await;
        let mut peer = rig.mock.peer("bob");
        peer.join(&id.0);
        peer.type_at(&id.0, 0, "Appendix");
        disk_matches(&rig, "appendix.tex", b"Appendix").await;
        rig.finish().await;
    });
}

#[test]
fn a_new_binary_from_the_web_is_downloaded_once_and_its_hash_learned() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let bob = bob(&rig).await;
        bob.rest
            .upload(&bob.session, &bob.root, "plot.png", PNG)
            .await
            .unwrap();
        disk_matches(&rig, "plot.png", PNG).await;
        settle(&rig).await;
        let fetched = calls(&rig, "GET", &format!("/blob/{}", short_hash(PNG)));
        assert_eq!(fetched, 1);
        let newer = b"\x89PNG\r\n\x1a\nnewer plot";
        bob.rest
            .upload(&bob.session, &bob.root, "plot.png", newer)
            .await
            .unwrap();
        disk_matches(&rig, "plot.png", newer).await;
        assert!(rig.host.removed.lock().unwrap().is_empty());
        rig.finish().await;
    });
}

#[test]
fn coauthor_rename_moves_open_tab_and_keeps_cursor() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let doc = rig.doc(NOTES);
        let mut tab = rig.open(NOTES);
        let bob = bob(&rig).await;
        settle(&rig).await;
        bob.rest
            .rename(
                &bob.session,
                NodeKind::Doc,
                &EntityId(doc.clone()),
                "renamed.tex",
            )
            .await
            .unwrap();
        disk_matches(&rig, "renamed.tex", b"Notes\n").await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        disk_gone(&rig, NOTES).await;
        let followed = rig.host.changes.lock().unwrap().iter().any(|change| {
            change
                .renamed
                .contains(&(NOTES.to_owned(), "renamed.tex".to_owned()))
        });
        assert!(followed, "the tab was not told to follow");
        assert!(detached(&tab).is_empty());
        tab.typed(&rig.live, "Notes, still live\n");
        eventually("typing after the rename reaches the server", || {
            rig.mock.doc_text(&doc) == "Notes, still live\n"
        })
        .await;
        rig.finish().await;
    });
}

#[test]
fn coauthor_delete_with_my_unsent_edits_keeps_a_copy() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let doc = rig.doc(NOTES);
        let mut tab = rig.open(NOTES);
        eventually("notes is joined", || rig.live.text_at(NOTES).is_some()).await;
        rig.mock.hold_updates();
        tab.typed(&rig.live, "Notes and mine\n");
        let bob = bob(&rig).await;
        bob.rest
            .delete(&bob.session, NodeKind::Doc, &EntityId(doc.clone()))
            .await
            .unwrap();
        disk_gone(&rig, NOTES).await;
        eventually("the removal is announced as mine too", || {
            rig.host.removed.lock().unwrap().iter().any(|payload| {
                payload
                    .files
                    .iter()
                    .any(|file| file.path == NOTES && file.yours)
            })
        })
        .await;
        let copy = removed_copy(&rig, NOTES);
        disk_matches(&rig, &copy, b"Notes and mine\n").await;
        assert_eq!(detached(&tab), vec!["removed".to_owned()]);
        assert!(rig.host.kept.lock().unwrap().is_empty());
        rig.mock.release_updates();
        rig.finish().await;
    });
}

#[test]
fn coauthor_folder_delete_closes_tabs_keeps_unsent_copies() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let mut tab = rig.open(INTRO);
        eventually("intro is joined", || rig.live.text_at(INTRO).is_some()).await;
        rig.mock.hold_updates();
        tab.typed(&rig.live, "Intro, mine\n");
        let bob = bob(&rig).await;
        let sections = entity(&rig, "sections");
        bob.rest
            .delete(&bob.session, NodeKind::Folder, &sections)
            .await
            .unwrap();
        disk_gone(&rig, INTRO).await;
        eventually("the folder removal is announced", || {
            rig.host.removed.lock().unwrap().iter().any(|payload| {
                payload
                    .files
                    .iter()
                    .any(|file| file.path == "sections" && file.yours)
            })
        })
        .await;
        let copy = removed_copy(&rig, "sections");
        assert!(copy.starts_with("sections/"), "{copy}");
        disk_matches(&rig, &copy, b"Intro, mine\n").await;
        rig.mock.release_updates();
        rig.finish().await;
    });
}

#[test]
fn remove_then_new_is_a_replace_without_banner() {
    run(async {
        let rig = ready(OverleafRig::start(project().file("plot.png", PNG), DISK).await).await;
        disk_matches(&rig, "plot.png", PNG).await;
        let tab = rig.open(NOTES);
        let bob = bob(&rig).await;
        let newer = b"\x89PNG\r\n\x1a\nreplaced";
        bob.rest
            .upload(&bob.session, &bob.root, "plot.png", newer)
            .await
            .unwrap();
        disk_matches(&rig, "plot.png", newer).await;
        bob.rest
            .upload(&bob.session, &bob.root, NOTES, b"now\0binary")
            .await
            .unwrap();
        disk_matches(&rig, NOTES, b"now\0binary").await;
        eventually("the open tab hears it was replaced", || {
            detached(&tab) == vec!["replaced".to_owned()]
        })
        .await;
        settle(&rig).await;
        assert!(rig.host.removed.lock().unwrap().is_empty());
        rig.finish().await;
    });
}

#[test]
fn a_replaced_doc_with_my_unsent_edits_keeps_a_copy_and_says_so() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let mut tab = rig.open(NOTES);
        eventually("notes is joined", || rig.live.text_at(NOTES).is_some()).await;
        rig.mock.hold_updates();
        tab.typed(&rig.live, "Notes and mine\n");
        let bob = bob(&rig).await;
        bob.rest
            .upload(&bob.session, &bob.root, NOTES, b"now\0binary")
            .await
            .unwrap();
        disk_matches(&rig, NOTES, b"now\0binary").await;
        eventually("the open tab hears it was replaced", || {
            detached(&tab) == vec!["replaced".to_owned()]
        })
        .await;
        eventually("the unsent text is announced as a kept copy", || {
            rig.host.kept.lock().unwrap().iter().any(|payload| {
                payload
                    .files
                    .iter()
                    .any(|file| file.path == NOTES && file.kind == KeptKind::Unsent)
            })
        })
        .await;
        let copy = rig.host.kept.lock().unwrap()[0].files[0].copy.clone();
        disk_matches(&rig, &copy, b"Notes and mine\n").await;
        settle(&rig).await;
        assert!(rig.host.removed.lock().unwrap().is_empty());
        rig.mock.release_updates();
        rig.finish().await;
    });
}

#[test]
fn a_new_local_tex_is_created_then_filled_by_op() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        put(&rig, "appendix.tex", b"Appendix text\n").await;
        import(&rig, &["appendix.tex"]).await;
        eventually("the server has the new doc and its text", || {
            rig.mock
                .entity_id("appendix.tex")
                .is_some_and(|id| rig.mock.doc_text(&id) == "Appendix text\n")
        })
        .await;
        settle(&rig).await;
        assert_eq!(calls(&rig, "POST", "/doc"), 1);
        assert_eq!(calls(&rig, "POST", "/upload"), 0);
        assert_eq!(
            on_disk(&rig, "appendix.tex").await.as_deref(),
            Some(&b"Appendix text\n"[..])
        );
        rig.finish().await;
    });
}

#[test]
fn a_new_binary_is_uploaded_once() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        put(&rig, "figures/plot.png", PNG).await;
        import(&rig, &["figures", "figures/plot.png"]).await;
        import(&rig, &["figures/plot.png"]).await;
        eventually("the upload lands", || {
            rig.mock.entity_id("figures/plot.png").is_some()
        })
        .await;
        settle(&rig).await;
        assert_eq!(calls(&rig, "POST", "/upload"), 1);
        assert_eq!(calls(&rig, "POST", "/folder"), 1);
        let blob = format!("/blob/{}", short_hash(PNG));
        assert_eq!(
            calls(&rig, "GET", &blob),
            0,
            "an uploaded file was fetched back"
        );
        assert_eq!(
            on_disk(&rig, "figures/plot.png").await.as_deref(),
            Some(PNG)
        );
        rig.finish().await;
    });
}

#[test]
fn a_changed_local_binary_replaces_overleafs() {
    run(async {
        let rig = ready(OverleafRig::start(project().file("plot.png", PNG), DISK).await).await;
        disk_matches(&rig, "plot.png", PNG).await;
        settle(&rig).await;
        let newer = b"\x89PNG\r\n\x1a\nmy newer plot";
        put(&rig, "plot.png", newer).await;
        import(&rig, &["plot.png"]).await;
        eventually("the server has my plot", || {
            rig.mock.file_bytes("plot.png").as_deref() == Some(&newer[..])
        })
        .await;
        settle(&rig).await;
        assert_eq!(on_disk(&rig, "plot.png").await.as_deref(), Some(&newer[..]));
        assert!(rig.host.kept.lock().unwrap().is_empty());
        rig.finish().await;
    });
}

fn short_hash(bytes: &[u8]) -> String {
    sha256_hex(bytes)[..40].to_owned()
}

#[test]
fn a_binary_that_differs_on_both_sides_keeps_theirs_and_mine_beside() {
    run(async {
        let rig = ready(OverleafRig::start(project().file("plot.png", PNG), DISK).await).await;
        disk_matches(&rig, "plot.png", PNG).await;
        settle(&rig).await;
        put(&rig, "plot.png", MINE).await;
        let theirs = b"\x89PNG\r\n\x1a\ntheirs";
        let bob = bob(&rig).await;
        bob.rest
            .upload(&bob.session, &bob.root, "plot.png", theirs)
            .await
            .unwrap();
        disk_matches(&rig, "plot.png", theirs).await;
        eventually("my version is kept beside", || {
            rig.host.kept.lock().unwrap().iter().any(|payload| {
                payload
                    .files
                    .iter()
                    .any(|file| file.path == "plot.png" && file.kind == KeptKind::Replaced)
            })
        })
        .await;
        let copy = rig
            .host
            .kept
            .lock()
            .unwrap()
            .iter()
            .flat_map(|payload| payload.files.clone())
            .find(|file| file.path == "plot.png")
            .map(|file| file.copy)
            .unwrap();
        disk_matches(&rig, &copy, MINE).await;
        import(&rig, &["plot.png"]).await;
        settle(&rig).await;
        assert_eq!(
            rig.mock.file_bytes("plot.png").as_deref(),
            Some(&theirs[..])
        );
        rig.finish().await;
    });
}

#[test]
fn a_local_rename_is_one_rest_call_confirmed_by_the_room() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let doc = rig.doc(NOTES);
        settle(&rig).await;
        tokio::fs::rename(rig.root.join(NOTES), rig.root.join("chapter.tex"))
            .await
            .unwrap();
        import(&rig, &[NOTES, "chapter.tex"]).await;
        eventually("the server renamed the same doc", || {
            rig.mock.entity_id("chapter.tex").as_deref() == Some(doc.as_str())
        })
        .await;
        settle(&rig).await;
        assert_eq!(calls(&rig, "POST", &format!("/doc/{doc}/rename")), 1);
        assert_eq!(calls(&rig, "POST", "/doc"), 0);
        assert_eq!(calls(&rig, "DELETE", &format!("/doc/{doc}")), 0);
        assert_eq!(
            on_disk(&rig, "chapter.tex").await.as_deref(),
            Some(&b"Notes\n"[..])
        );
        assert!(on_disk(&rig, NOTES).await.is_none());
        rig.finish().await;
    });
}

#[test]
fn a_local_folder_rename_is_one_call_for_the_folder() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let sections = rig.mock.entity_id("sections").unwrap();
        let intro = rig.doc(INTRO);
        settle(&rig).await;
        tokio::fs::rename(rig.root.join("sections"), rig.root.join("chapters"))
            .await
            .unwrap();
        import(&rig, &["sections", "chapters"]).await;
        eventually("the server renamed the folder", || {
            rig.mock.entity_id("chapters/intro.tex").as_deref() == Some(intro.as_str())
        })
        .await;
        settle(&rig).await;
        assert_eq!(
            calls(&rig, "POST", &format!("/folder/{sections}/rename")),
            1
        );
        assert_eq!(calls(&rig, "POST", "/doc"), 0);
        assert_eq!(
            on_disk(&rig, "chapters/intro.tex").await.as_deref(),
            Some(&b"Intro\n"[..])
        );
        rig.finish().await;
    });
}

#[test]
fn a_local_delete_asks_by_default() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        settle(&rig).await;
        tokio::fs::remove_file(rig.root.join(NOTES)).await.unwrap();
        import(&rig, &[NOTES]).await;
        import(&rig, &[NOTES]).await;
        assert_eq!(
            told(&rig),
            vec![TreeNoticeKind::DeleteAsked {
                paths: vec![NOTES.to_owned()]
            }]
        );
        assert!(rig.mock.entity_id(NOTES).is_some());
        rig.live.decide_deletes(&[NOTES.to_owned()], true);
        eventually("the server deleted it", || {
            rig.mock.entity_id(NOTES).is_none()
        })
        .await;
        settle(&rig).await;
        assert!(on_disk(&rig, NOTES).await.is_none());
        assert!(rig.host.removed.lock().unwrap().is_empty());
        rig.finish().await;
    });
}

#[test]
fn keep_on_overleaf_records_kept_away_and_is_not_recreated() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let doc = rig.doc(NOTES);
        settle(&rig).await;
        tokio::fs::remove_file(rig.root.join(NOTES)).await.unwrap();
        import(&rig, &[NOTES]).await;
        rig.live.decide_deletes(&[NOTES.to_owned()], false);
        assert!(told(&rig).contains(&TreeNoticeKind::KeptAway {
            paths: vec![NOTES.to_owned()]
        }));
        assert_eq!(rig.live.session.kept_away(), vec![NOTES.to_owned()]);
        let mut peer = rig.mock.peer("bob");
        peer.join(&doc);
        peer.type_at(&doc, 0, "More ");
        settle(&rig).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(on_disk(&rig, NOTES).await.is_none());
        assert_eq!(rig.mock.doc_text(&doc), "More Notes\n");
        assert_eq!(calls(&rig, "DELETE", &format!("/doc/{doc}")), 0);
        assert!(rig.host.removed.lock().unwrap().is_empty());
        rig.finish().await;
    });
}

#[test]
fn viewer_tree_change_is_refused_before_sending() {
    run(async {
        let rig = ready(OverleafRig::start_as(project(), DISK, "vera").await).await;
        settle(&rig).await;
        put(&rig, "mine.tex", b"Mine\n").await;
        tokio::fs::remove_file(rig.root.join(NOTES)).await.unwrap();
        import(&rig, &["mine.tex", NOTES]).await;
        let refused = told(&rig).into_iter().find_map(|kind| match kind {
            TreeNoticeKind::NotAllowed { paths } => Some(paths),
            _ => None,
        });
        assert_eq!(refused, Some(vec!["mine.tex".to_owned(), NOTES.to_owned()]));
        assert_eq!(rig.live.session.kept_away(), vec![NOTES.to_owned()]);
        settle(&rig).await;
        let writes = rig
            .mock
            .requests(&format!("/project/{}/", rig.mock.project_id()))
            .into_iter()
            .filter(|request| request.method != "GET")
            .count();
        assert_eq!(writes, 0);
        assert!(rig.mock.entity_id(NOTES).is_some());
        assert!(on_disk(&rig, NOTES).await.is_none());
        rig.finish().await;
    });
}

#[test]
fn empty_left_behind_folders_are_removed() {
    run(async {
        let rig = ready(
            OverleafRig::start(
                project().doc("drafts/old.tex", "Old\n"),
                &[
                    (MAIN, "Hello\n"),
                    (NOTES, "Notes\n"),
                    (INTRO, "Intro\n"),
                    ("drafts/old.tex", "Old\n"),
                ],
            )
            .await,
        )
        .await;
        put(&rig, "sections/intro.aux", b"build output").await;
        settle(&rig).await;
        let bob = bob(&rig).await;
        for folder in ["drafts", "sections"] {
            bob.rest
                .delete(&bob.session, NodeKind::Folder, &entity(&rig, folder))
                .await
                .unwrap();
        }
        disk_gone(&rig, "drafts").await;
        disk_gone(&rig, INTRO).await;
        assert_eq!(
            on_disk(&rig, "sections/intro.aux").await.as_deref(),
            Some(&b"build output"[..])
        );
        rig.finish().await;
    });
}

#[test]
fn windows_invalid_names_checked_on_every_os() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let bob = bob(&rig).await;
        for name in ["con.tex", "what?.tex"] {
            bob.rest
                .create_doc(&bob.session, &bob.root, name)
                .await
                .unwrap();
        }
        settle(&rig).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        let mut names = Vec::new();
        let mut entries = tokio::fs::read_dir(&rig.root).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            names.push(entry.file_name().to_string_lossy().to_string());
        }
        assert!(
            !names
                .iter()
                .any(|name| name == "con.tex" || name == "what?.tex"),
            "{names:?}"
        );
        assert_eq!(
            names.iter().filter(|name| name.ends_with(".tex")).count(),
            4,
            "{names:?}"
        );
        rig.finish().await;
    });
}

#[test]
fn two_names_differing_by_case_do_not_clash_on_macos_and_windows() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let bob = bob(&rig).await;
        let id = bob
            .rest
            .create_doc(&bob.session, &bob.root, "Notes.tex")
            .await
            .unwrap();
        let mut peer = rig.mock.peer("bob");
        peer.join(&id.0);
        peer.type_at(&id.0, 0, "Capital");
        settle(&rig).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(on_disk(&rig, NOTES).await.as_deref(), Some(&b"Notes\n"[..]));
        let mut found = false;
        let mut entries = tokio::fs::read_dir(&rig.root).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.to_lowercase() != NOTES && name.ends_with(".tex") && name != MAIN {
                found |= tokio::fs::read(entry.path()).await.unwrap() == b"Capital";
            }
        }
        assert!(found, "the second name did not get its own file");
        rig.finish().await;
    });
}

#[test]
fn a_clashing_rename_keeps_the_old_local_path() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let bob = bob(&rig).await;
        bob.rest
            .rename(
                &bob.session,
                NodeKind::Doc,
                &entity(&rig, MAIN),
                "NOTES.tex",
            )
            .await
            .unwrap();
        settle(&rig).await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(on_disk(&rig, NOTES).await.as_deref(), Some(&b"Notes\n"[..]));
        let mut texts = Vec::new();
        let mut entries = tokio::fs::read_dir(&rig.root).await.unwrap();
        while let Some(entry) = entries.next_entry().await.unwrap() {
            if entry.file_type().await.unwrap().is_file() {
                texts.push(tokio::fs::read(entry.path()).await.unwrap());
            }
        }
        assert!(
            texts.contains(&b"Hello\n".to_vec()),
            "the renamed doc was lost"
        );
        rig.finish().await;
    });
}

#[test]
fn a_refused_upload_shows_retry_and_dismiss_puts_it_back() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let route = format!("/project/{}/upload", rig.mock.project_id());
        rig.mock.plan_fault(
            Some("POST"),
            &route,
            oleafly_online::test_support::mock_overleaf::Fault::Reply(
                422,
                r#"{"success":false,"error":"invalid"}"#.into(),
            ),
        );
        put(&rig, "plot.png", PNG).await;
        import(&rig, &["plot.png"]).await;
        eventually("the upload shows as failed", || {
            rig.live.upload_list().iter().any(|file| {
                file.path == "plot.png"
                    && file.state == crate::collab::live::uploads::UploadState::Failed
            })
        })
        .await;
        assert!(rig
            .host
            .uploads
            .lock()
            .unwrap()
            .iter()
            .any(|payload| payload.files.iter().any(|file| file.path == "plot.png")));
        rig.live.retry_uploads();
        eventually("the retry lands", || {
            rig.mock.entity_id("plot.png").is_some()
        })
        .await;
        eventually("the list empties", || rig.live.upload_list().is_empty()).await;
        rig.finish().await;
    });
}

fn replayed(
    join: serde_json::Value,
    events: Vec<oleafly_online::realtime::events::ServerEvent>,
) -> Vec<oleafly_collab::materialize::DiskPlan> {
    use oleafly_collab::materialize;
    use oleafly_online::realtime::events::ServerEvent;
    let mut state = oleafly_online::realtime::project::ProjectState::from_join(join).unwrap();
    let mut previous = materialize::layout(&super::tree::file_nodes(&state.tree.nodes()));
    let mut plans = Vec::new();
    let now = std::time::Instant::now();
    for event in events {
        let ServerEvent::Tree(event) = event else {
            continue;
        };
        state.tree.apply(&event, now);
        let next = materialize::layout(&super::tree::file_nodes(&state.tree.nodes()));
        plans.push(materialize::plan(&previous, &next));
        previous = next;
    }
    state.tree.flush();
    let next = materialize::layout(&super::tree::file_nodes(&state.tree.nodes()));
    plans.push(materialize::plan(&previous, &next));
    plans
}

fn recorded(
    frames: impl Iterator<Item = (bool, String)>,
) -> (
    serde_json::Value,
    Vec<oleafly_online::realtime::events::ServerEvent>,
) {
    use oleafly_online::realtime::codec;
    use oleafly_online::realtime::events::ServerEvent;
    let incoming: Vec<(String, Vec<serde_json::Value>)> = frames
        .filter(|(outgoing, _)| !outgoing)
        .filter_map(|(_, raw)| codec::decode(&raw).ok()?.into_event())
        .collect();
    let join = incoming
        .iter()
        .find(|(name, _)| name == "joinProjectResponse")
        .map(|(_, args)| args[0].clone())
        .unwrap();
    let events = incoming
        .into_iter()
        .filter(|(name, _)| name != "joinProjectResponse")
        .map(|(name, args)| ServerEvent::from_wire(&name, &args))
        .collect();
    (join, events)
}

#[test]
fn recorded_tree_events_plan_the_right_disk_changes() {
    use oleafly_online::test_support::overleaf_rt::{probe_frames, recordings};
    let (join, events) = recorded(
        probe_frames("upload-replace-and-convert", "websocket")
            .into_iter()
            .map(|frame| (frame.outgoing, frame.raw)),
    );
    let plans = replayed(join, events);
    let removed: Vec<&String> = plans.iter().flat_map(|plan| &plan.removed).collect();
    let moved: Vec<&(String, String)> = plans.iter().flat_map(|plan| &plan.moved).collect();
    assert!(moved.is_empty(), "{moved:?}");
    assert!(
        removed.iter().all(|path| path.starts_with("convert-probe")),
        "{removed:?}"
    );
    for name in ["rename-while-open", "delete-open-file"] {
        let recording = recordings()
            .into_iter()
            .find(|recording| recording.name == name)
            .unwrap();
        let doc = recording.summary["doc"]["name"]
            .as_str()
            .unwrap()
            .to_owned();
        for trace in &recording.traces {
            let (join, events) = recorded(
                trace
                    .frames
                    .iter()
                    .map(|frame| (frame.outgoing, frame.raw.clone())),
            );
            let plans = replayed(join, events);
            let moved: Vec<(String, String)> =
                plans.iter().flat_map(|plan| plan.moved.clone()).collect();
            let removed: Vec<String> = plans.iter().flat_map(|plan| plan.removed.clone()).collect();
            match name {
                "rename-while-open" => {
                    assert_eq!(moved.len(), 1, "{name} {}: {moved:?}", trace.name);
                    assert_eq!(moved[0].0, doc);
                    assert!(removed.is_empty(), "{removed:?}");
                }
                _ => {
                    assert_eq!(removed, vec![doc.clone()], "{name} {}", trace.name);
                    assert!(moved.is_empty());
                }
            }
        }
    }
}

#[test]
fn restore_on_overleaf_recreates_from_kept_copy() {
    run(async {
        let rig = ready(OverleafRig::start(project(), DISK).await).await;
        let doc = rig.doc(NOTES);
        let mut tab = rig.open(NOTES);
        eventually("notes is joined", || rig.live.text_at(NOTES).is_some()).await;
        rig.mock.hold_updates();
        tab.typed(&rig.live, "Notes and mine\n");
        let bob = bob(&rig).await;
        bob.rest
            .delete(&bob.session, NodeKind::Doc, &EntityId(doc.clone()))
            .await
            .unwrap();
        rig.mock.release_updates();
        disk_gone(&rig, NOTES).await;
        eventually("the removal names the kept copy", || {
            rig.host
                .removed
                .lock()
                .unwrap()
                .iter()
                .any(|payload| payload.files.iter().any(|file| file.copy.is_some()))
        })
        .await;
        let copy = removed_copy(&rig, NOTES);
        rig.live.restore(NOTES).await.unwrap();
        eventually("the doc is back on the server with my text", || {
            rig.mock
                .entity_id(NOTES)
                .is_some_and(|id| rig.mock.doc_text(&id) == "Notes and mine\n")
        })
        .await;
        assert_ne!(rig.mock.entity_id(NOTES).as_deref(), Some(doc.as_str()));
        settle(&rig).await;
        assert!(on_disk(&rig, &copy).await.is_none());
        assert!(rig.mock.entity_id(&copy).is_none());
        assert_eq!(
            on_disk(&rig, NOTES).await.as_deref(),
            Some(&b"Notes and mine\n"[..])
        );
        rig.finish().await;
    });
}
