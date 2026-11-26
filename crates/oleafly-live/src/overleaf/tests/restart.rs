use std::future::Future;

use oleafly_online::live::journal::manifest_of;
use oleafly_online::live::rest::ProjectRest;
use oleafly_online::realtime::events::EntityId;
use oleafly_online::realtime::tree::NodeKind;
use oleafly_online::realtime::ProjectPage;

use super::*;
use crate::overleaf::TreeNoticeKind;

const FILES: [(&str, &str); 2] = [(MAIN, "Hello\n"), (INTRO, "Intro\n")];
const NOTES: &str = "notes.tex";

fn run(test: impl Future<Output = ()>) {
    runtime().block_on(test);
}

async fn off() -> World {
    let world = World::imported(project(), &FILES).await;
    world.set_history(Some(0)).await;
    let rig = world.start().await.online_once().await;
    let disk = &rig.live.mirror.disk;
    eventually("every file is in the index", || {
        let state = guard(&disk.disk);
        FILES.iter().all(|(path, _)| {
            state.hashes.contains_key(*path)
                && state.layout.values().any(|placed| placed.path == *path)
        })
    })
    .await;
    rig.stop().await
}

fn reviews(rig: &Rig) -> usize {
    guard(&rig.host.notices)
        .iter()
        .filter(|told| matches!(told.notice, OverleafNotice::NeedsReview { .. }))
        .count()
}

#[test]
fn an_offline_edit_merges_with_a_coauthors() {
    run(async {
        let world = off().await;
        world.write(MAIN, "Hello\nmine\n");
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await;
        let merged = "Theirs\nHello\nmine\n";
        eventually("both edits are online and in the folder", || {
            rig.online(MAIN).as_deref() == Some(merged) && rig.read(MAIN) == merged
        })
        .await;
        assert_eq!(reviews(&rig), 0);
        assert!(rig.copies_of(MAIN).is_empty());
        rig.stop().await;
    });
}

#[test]
fn overlapping_offline_edits_wait_for_review() {
    run(async {
        let world = off().await;
        world.write(MAIN, "Mine\n");
        let main = world.mock.doc_id(MAIN);
        let mut bob = world.mock.peer("bob");
        bob.join(&main);
        bob.delete(&main, 0, 5);
        bob.type_at(&main, 0, "Theirs");
        let rig = world.start().await;
        eventually("the review is asked for", || reviews(&rig) == 1).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(rig.online(MAIN).as_deref(), Some("Theirs\n"));
        assert_eq!(rig.read(MAIN), "Mine\n");
        rig.live
            .resolve(MAIN, oleafly_online::live::session::Resolution::Theirs)
            .unwrap();
        eventually("the online text is in the file", || {
            rig.read(MAIN) == "Theirs\n"
        })
        .await;
        eventually("my text is kept beside it", || {
            rig.copies_of(MAIN) == ["Mine\n"]
        })
        .await;
        rig.stop().await;
    });
}

#[test]
fn an_edit_sent_before_the_stop_never_reverts_a_coauthors_later_one() {
    run(async {
        let world = World::imported(project(), &FILES).await;
        let rig = world.start().await.online_once().await;
        eventually("the first pass ran", || {
            !guard(&rig.live.mirror.disk.disk).layout.is_empty()
        })
        .await;
        rig.write(MAIN, "Hello\nmine\n");
        rig.live
            .import_paths(Some(vec![MAIN.to_owned()]))
            .await
            .unwrap();
        eventually("my edit is online", || {
            rig.online(MAIN).as_deref() == Some("Hello\nmine\n")
        })
        .await;
        let world = rig.stop().await;
        let main = world.mock.doc_id(MAIN);
        let mut bob = world.mock.peer("bob");
        bob.join(&main);
        bob.delete(&main, 6, 5);
        bob.type_at(&main, 0, "Theirs\n");
        let rig = world.start().await.online_once().await;
        eventually("the coauthor's edit reaches the folder", || {
            rig.read(MAIN) == "Theirs\nHello\n"
        })
        .await;
        assert_eq!(rig.online(MAIN).as_deref(), Some("Theirs\nHello\n"));
        rig.stop().await;
    });
}

#[test]
fn an_offline_edit_whose_last_text_is_gone_waits_for_review() {
    run(async {
        let world = off().await;
        std::fs::remove_dir_all(world.mirror_dir.join("texts")).unwrap_or_default();
        world.write(MAIN, "Hello\nmine\n");
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await;
        eventually("the review is asked for", || reviews(&rig) == 1).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(rig.online(MAIN).as_deref(), Some("Theirs\nHello\n"));
        assert_eq!(rig.read(MAIN), "Hello\nmine\n");
        rig.stop().await;
    });
}

#[test]
fn an_offline_edit_is_sent_even_when_the_history_reports_nothing() {
    run(async {
        let world = off().await;
        world.set_history(Some(0)).await;
        let joined = world.mock.received("joinDoc").len();
        world.write(INTRO, "Intro\noffline\n");
        let rig = world.start().await;
        eventually("the edit is online", || {
            rig.online(INTRO).as_deref() == Some("Intro\noffline\n")
        })
        .await;
        assert_eq!(rig.read(INTRO), "Intro\noffline\n");
        assert_eq!(
            rig.mock.received("joinDoc").len(),
            joined + 1,
            "only the changed document needed joining"
        );
        rig.stop().await;
    });
}

#[test]
fn a_file_made_while_off_is_created_online() {
    run(async {
        let world = off().await;
        world.write(NOTES, "Notes\n");
        let rig = world.start().await;
        eventually("the new file is online", || {
            rig.online(NOTES).as_deref() == Some("Notes\n")
        })
        .await;
        assert_eq!(rig.read(NOTES), "Notes\n");
        rig.stop().await;
    });
}

#[test]
fn a_file_made_on_both_sides_while_off_waits_for_review() {
    run(async {
        let world = off().await;
        world.write(NOTES, "My notes\n");
        online_editor(&world)
            .await
            .add(NOTES, "Their notes\n")
            .await;
        let rig = world.start().await;
        eventually("the review is asked for", || reviews(&rig) == 1).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(rig.online(NOTES).as_deref(), Some("Their notes\n"));
        assert_eq!(rig.read(NOTES), "My notes\n");
        rig.stop().await;
    });
}

#[test]
fn a_file_deleted_while_off_is_asked_about_once_the_role_is_known() {
    run(async {
        let world = off().await;
        std::fs::remove_file(world.root.join(INTRO)).unwrap();
        world.mock.crash();
        let rig = world.start().await;
        assert!(guard(&rig.host.tree).is_empty());
        rig.mock.recover();
        eventually("the delete is asked about", || {
            guard(&rig.host.tree).iter().any(|notice| {
                notice.kind
                    == TreeNoticeKind::DeleteAsked {
                        paths: vec![INTRO.to_owned()],
                    }
            })
        })
        .await;
        assert!(!guard(&rig.host.tree).iter().any(|notice| matches!(
            notice.kind,
            TreeNoticeKind::NotAllowed { .. } | TreeNoticeKind::KeptAway { .. }
        )));
        rig.stop().await;
    });
}

#[test]
fn an_index_without_a_join_snapshot_deletes_nothing_while_the_server_is_down() {
    run(async {
        let world = off().await;
        drop(world.journal().await);
        std::fs::remove_dir_all(&world.data).unwrap();
        world.mock.crash();
        let rig = world.start().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        for (path, text) in FILES {
            assert_eq!(rig.read(path), text, "{path} while the server is down");
        }
        rig.mock.recover();
        let rig = rig.online_once().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        for (path, text) in FILES {
            assert_eq!(rig.read(path), text, "{path} once joined");
        }
        rig.stop().await;
    });
}

struct OnlineEditor<'a> {
    world: &'a World,
    rest: ProjectRest,
    session: SessionHandle,
}

async fn online_editor(world: &World) -> OnlineEditor<'_> {
    let http = Http::new(&world.mock.base, "Oleafly/test").unwrap();
    let bob = world.mock.user("bob");
    let session = SessionHandle::new(
        &world.mock.base,
        Session {
            cookie: bob.cookie(),
            user_id: bob.id,
            email: bob.email,
            saved_by: None,
        },
        None,
    );
    let page = ProjectPage::load(&http, &session, &world.mock.project_id(), false)
        .await
        .unwrap();
    OnlineEditor {
        world,
        rest: ProjectRest::new(http, Arc::new(page), &world.mock.project_id()),
        session,
    }
}

impl OnlineEditor<'_> {
    async fn add(&self, name: &str, text: &str) {
        let folder = EntityId(self.world.mock.root_folder_id());
        self.rest
            .create_doc(&self.session, &folder, name)
            .await
            .unwrap();
        self.world.bob_types(name, text);
    }

    async fn rename(&self, path: &str, name: &str) {
        let doc = EntityId(self.world.mock.doc_id(path));
        self.rest
            .rename(&self.session, NodeKind::Doc, &doc, name)
            .await
            .unwrap();
    }
}

#[test]
fn files_added_and_renamed_after_the_last_connect_stay_put_until_the_next_one() {
    run(async {
        let world = World::imported(project(), &FILES).await;
        world.set_history(Some(0)).await;
        let rig = world.start().await.online_once().await;
        let editor = online_editor(&rig).await;
        editor.add(NOTES, "Notes\n").await;
        editor.rename(INTRO, "opening.tex").await;
        eventually("the folder follows", || {
            rig.read(NOTES) == "Notes\n"
                && rig.read("opening.tex") == "Intro\n"
                && !rig.root.join(INTRO).exists()
        })
        .await;
        let world = rig.stop().await;
        world.mock.crash();
        let rig = world.start().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(rig.read(NOTES), "Notes\n");
        assert_eq!(rig.read("opening.tex"), "Intro\n");
        assert!(!rig.root.join(INTRO).exists());
        rig.mock.recover();
        let rig = rig.online_once().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(rig.read(NOTES), "Notes\n");
        assert_eq!(rig.read("opening.tex"), "Intro\n");
        rig.stop().await;
    });
}

#[test]
fn an_edit_made_before_a_first_start_that_never_connected_is_merged_at_the_next() {
    run(async {
        let world = World::imported(project(), &FILES).await;
        world.write(MAIN, "Hello\nmine\n");
        world.mock.crash();
        let rig = world.start().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert_eq!(rig.live.changed_here().await.unwrap(), [MAIN]);
        let world = rig.stop().await;
        world.mock.recover();
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await;
        let merged = "Theirs\nHello\nmine\n";
        eventually("both edits are online and in the folder", || {
            rig.online(MAIN).as_deref() == Some(merged) && rig.read(MAIN) == merged
        })
        .await;
        rig.stop().await;
    });
}

#[test]
fn opening_into_an_empty_folder_writes_every_text_when_a_journal_exists() {
    run(async {
        let world = off().await;
        let journaled = manifest_of(&world.data, &world.mock.base, &world.mock.project_id());
        assert!(journaled.is_some_and(|manifest| manifest.history_version.is_some()));
        for (path, _) in FILES {
            std::fs::remove_file(world.root.join(path)).unwrap();
        }
        std::fs::remove_dir_all(&world.mirror_dir).unwrap();
        opening::mark(&world.mirror_dir).unwrap();
        let rig = world.start().await;
        eventually("every text is written", || {
            FILES.iter().all(|(path, text)| rig.read(path) == *text)
        })
        .await;
        eventually("the open finishes", || {
            guard(&rig.host.notices)
                .iter()
                .any(|told| told.notice == OverleafNotice::Filled)
        })
        .await;
        rig.stop().await;
    });
}

#[test]
fn an_offline_edit_stays_journaled_through_a_start_that_never_connects() {
    run(async {
        let world = off().await;
        world.write(MAIN, "Hello\nmine\n");
        world.mock.crash();
        let rig = world.start().await;
        tokio::time::sleep(Duration::from_millis(700)).await;
        let world = rig.stop().await;
        assert_eq!(world.read(MAIN), "Hello\nmine\n");
        world.mock.recover();
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await;
        let merged = "Theirs\nHello\nmine\n";
        eventually("both edits are online and in the folder", || {
            rig.online(MAIN).as_deref() == Some(merged) && rig.read(MAIN) == merged
        })
        .await;
        assert_eq!(reviews(&rig), 0);
        rig.stop().await;
    });
}

fn not_allowed(rig: &Rig) -> Vec<String> {
    guard(&rig.host.tree)
        .iter()
        .filter_map(|notice| match &notice.kind {
            TreeNoticeKind::NotAllowed { paths } => Some(paths.clone()),
            _ => None,
        })
        .flatten()
        .collect()
}

#[test]
fn a_viewers_files_with_no_import_record_follow_the_online_text() {
    run(async {
        let mut world = World::imported(project(), &FILES).await;
        world.user = "vera";
        std::fs::remove_dir_all(&world.mirror_dir).unwrap();
        world.set_history(Some(0)).await;
        let rig = world.start().await.online_once().await;
        eventually("both files are known to match", || {
            let state = guard(&rig.live.mirror.disk.disk);
            FILES
                .iter()
                .all(|(path, _)| state.hashes.contains_key(*path))
        })
        .await;
        rig.bob_types(MAIN, "Theirs\n");
        eventually("a coauthor's edit reaches the folder", || {
            rig.read(MAIN) == "Theirs\nHello\n"
        })
        .await;
        assert_eq!(not_allowed(&rig), Vec::<String>::new());
        rig.stop().await;
    });
}

#[test]
fn a_viewers_offline_edit_stays_here_and_is_told_once() {
    run(async {
        let mut world = World::imported(project(), &FILES).await;
        world.user = "vera";
        world.set_history(Some(0)).await;
        let rig = world.start().await.online_once().await;
        eventually("both files are known to match", || {
            let state = guard(&rig.live.mirror.disk.disk);
            !state.layout.is_empty() && state.hashes.contains_key(MAIN)
        })
        .await;
        let world = rig.stop().await;
        world.write(MAIN, "Hello\nmine\n");
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await.online_once().await;
        eventually("the edit is refused", || not_allowed(&rig) == [MAIN]).await;
        tokio::time::sleep(Duration::from_millis(500)).await;
        assert_eq!(rig.read(MAIN), "Hello\nmine\n");
        assert_eq!(rig.online(MAIN).as_deref(), Some("Theirs\nHello\n"));
        assert!(rig.copies_of(MAIN).is_empty());
        assert_eq!(not_allowed(&rig), [MAIN]);
        rig.stop().await;
    });
}

#[cfg(unix)]
fn allow(path: &Path, mode: u32) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(mode)).unwrap();
}

#[cfg(unix)]
#[test]
fn one_unreadable_file_or_folder_holds_up_nothing_else() {
    run(async {
        const CLOSED: &str = "closed/part.tex";
        let world = World::imported(project(), &FILES).await;
        world.set_history(Some(0)).await;
        std::fs::create_dir(world.root.join("closed")).unwrap();
        let rig = world.start().await.online_once().await;
        rig.write(CLOSED, "Part\n");
        rig.live.import_paths(None).await.unwrap();
        eventually("the file in the folder is online", || {
            rig.online(CLOSED).as_deref() == Some("Part\n")
        })
        .await;
        eventually("the folder knows it", || {
            let state = guard(&rig.live.mirror.disk.disk);
            state.layout.values().any(|placed| placed.path == CLOSED)
        })
        .await;
        rig.write(INTRO, "Intro\nmine\n");
        rig.write(MAIN, "Hello\nmine\n");
        let (intro, folder) = (rig.root.join(INTRO), rig.root.join("closed"));
        allow(&intro, 0);
        allow(&folder, 0);
        let denied = std::fs::read(&intro).is_err();
        rig.live.import_paths(None).await.unwrap();
        allow(&intro, 0o644);
        allow(&folder, 0o755);
        if !denied {
            rig.stop().await;
            return;
        }
        eventually("the readable edit is online", || {
            rig.online(MAIN).as_deref() == Some("Hello\nmine\n")
        })
        .await;
        assert!(guard(&rig.host.tree)
            .iter()
            .all(|notice| !matches!(notice.kind, TreeNoticeKind::DeleteAsked { .. })));
        assert_eq!(rig.online(INTRO).as_deref(), Some("Intro\n"));
        rig.live.import_paths(None).await.unwrap();
        eventually("the other edit follows once it can be read", || {
            rig.online(INTRO).as_deref() == Some("Intro\nmine\n")
        })
        .await;
        let log = logged(&rig.data);
        assert_eq!(log.matches("so its changes wait").count(), 1, "{log}");
        rig.stop().await;
    });
}

#[test]
fn a_session_with_nothing_to_write_still_keeps_the_texts_an_older_version_never_kept() {
    run(async {
        let world = off().await;
        std::fs::remove_dir_all(world.mirror_dir.join("texts")).unwrap();
        let world = world.start().await.online_once().await.stop().await;
        world.write(MAIN, "Hello\nmine\n");
        world.bob_types(MAIN, "Theirs\n");
        let rig = world.start().await;
        eventually("the offline edit merges", || {
            rig.online(MAIN).as_deref() == Some("Theirs\nHello\nmine\n")
        })
        .await;
        assert_eq!(reviews(&rig), 0);
        rig.stop().await;
    });
}

#[test]
fn only_a_file_changed_outside_counts_when_a_stopped_document_is_tried_again() {
    run(async {
        let rig = off().await.start().await.online_once().await;
        let mirror = &rig.live.mirror;
        assert_eq!(mirror.outside_text(MAIN), None);
        guard(&mirror.disk.bases).record(MAIN, "Hello\nkept\n");
        rig.write(MAIN, "Hello\nmine\n");
        let found = mirror.outside_text(MAIN).unwrap();
        assert_eq!(found.base.as_deref(), Some("Hello\nkept\n"));
        assert_eq!(found.text, "Hello\nmine\n");
        assert_eq!(mirror.outside_text(MAIN), None);
        rig.stop().await;
    });
}
