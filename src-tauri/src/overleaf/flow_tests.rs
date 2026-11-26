use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::CollabPaths;
use oleafly_online::test_support::mock_overleaf::{
    Fault, MockOverleaf, MockProject, MockUser, Privilege,
};

use super::import::{self, OpenedLive};
use super::{create, links, OverleafLink};
use crate::collab::live::overleaf::commands::{live_now, live_project, start};
use crate::collab::live::overleaf::notices::OverleafNotice;
use crate::collab::live::overleaf::rig::{eventually, run, session_of, Quiet};
use crate::collab::live::overleaf::{mirror_dir, opening, TreeNoticeKind, IMPORT_BASES};
use crate::collab::live::LiveHost;
use crate::collab::testing::TempLibrary;

const MAIN: &str = "main.tex";
const INTRO: &str = "sections/intro.tex";
const FIGURE: &str = "figure.png";
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nfigure";

fn collab_paths() -> CollabPaths {
    CollabPaths::new(crate::paths::collab_root().unwrap())
}

fn signed_in_as(base: &str, user: &MockUser) {
    let store = crate::secrets::store().unwrap();
    oleafly_online::session::save(&store, base, &session_of(user)).unwrap();
}

fn on_overleaf() -> MockProject {
    MockProject::new("Thesis")
        .doc(MAIN, "\\documentclass{article}\nHello\n")
        .doc(INTRO, "Intro\n")
        .file(FIGURE, PNG)
        .root_doc(MAIN)
}

fn meta_of(project_id: &str) -> serde_json::Value {
    let path = crate::paths::project_dir(project_id)
        .unwrap()
        .join("project.json");
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}

fn mirror_of(mock: &MockOverleaf, user: &MockUser, project_id: &str) -> std::path::PathBuf {
    let link = OverleafLink {
        server: mock.base.clone(),
        project_id: mock.project_id(),
        user_id: Some(user.id.clone()),
    };
    mirror_dir(&crate::paths::oleafly_root().unwrap(), &link, project_id).unwrap()
}

fn on_disk(project_id: &str, path: &str) -> Option<Vec<u8>> {
    std::fs::read(crate::paths::project_dir(project_id).unwrap().join(path)).ok()
}

fn told(host: &Quiet, wanted: impl Fn(&OverleafNotice) -> bool) -> bool {
    host.notices
        .lock()
        .unwrap()
        .iter()
        .any(|payload| wanted(&payload.notice))
}

async fn go_live(host: &Arc<Quiet>, project_id: &str) {
    start(
        Arc::clone(host) as Arc<dyn LiveHost>,
        &collab_paths(),
        project_id,
    )
    .await
    .unwrap();
}

fn no_zip(mock: &MockOverleaf) -> bool {
    mock.requests("/project")
        .iter()
        .all(|request| !request.path.contains("/download/zip"))
}

#[test]
fn opening_one_project_twice_at_once_makes_one_copy() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(on_overleaf()).await;
        signed_in_as(&mock.base, &mock.user("alice"));
        let id = mock.project_id();
        let (first, second) = tokio::join!(
            import::open_live(&mock.base, None, &id),
            import::open_live(&mock.base, None, &id)
        );
        let (first, second) = (first.unwrap(), second.unwrap());
        assert_eq!(first.project_id, second.project_id);
        assert_ne!(first.reused, second.reused);
    });
    drop(library);
}

#[test]
fn opening_live_fills_a_new_folder_without_a_zip_and_then_finishes_the_open() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(on_overleaf()).await;
        let alice = mock.user("alice");
        signed_in_as(&mock.base, &alice);
        let OpenedLive { project_id, reused } =
            import::open_live(&mock.base, None, &mock.project_id())
                .await
                .unwrap();
        assert!(!reused);
        let meta = meta_of(&project_id);
        assert_eq!(meta["name"], "Thesis");
        assert_eq!(meta["main_doc"], MAIN);
        assert_eq!(meta["engine"], "latexmk");
        assert_eq!(meta["tex_flavor"], "pdflatex");
        assert_eq!(
            meta["importedFrom"]["projectId"],
            mock.project_id().as_str()
        );
        assert_eq!(meta["importedFrom"]["userId"], alice.id.as_str());
        assert!(on_disk(&project_id, MAIN).is_none());
        let mirror = mirror_of(&mock, &alice, &project_id);
        assert!(opening::marked(&mirror));
        assert!(live_project(&project_id).unwrap().unwrap().unfilled);

        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        eventually("the files arrive", || {
            on_disk(&project_id, MAIN).is_some()
                && on_disk(&project_id, INTRO).as_deref() == Some(b"Intro\n".as_slice())
                && on_disk(&project_id, FIGURE).as_deref() == Some(PNG)
        })
        .await;
        eventually("the open finishes", || {
            told(&host, |notice| matches!(notice, OverleafNotice::Filled))
        })
        .await;
        assert!(told(&host, |notice| matches!(
            notice,
            OverleafNotice::Filling { done: 2, total: 2 }
        )));
        assert!(!opening::marked(&mirror));
        assert!(!live_project(&project_id).unwrap().unwrap().unfilled);
        assert!(no_zip(&mock));

        let again = import::open_live(&mock.base, None, &mock.project_id())
            .await
            .unwrap();
        assert_eq!(
            again,
            OpenedLive {
                project_id: project_id.clone(),
                reused: true
            }
        );
        crate::collab::live::stop(&project_id).await;
    });
    drop(library);
}

#[test]
fn a_leftover_opening_mark_is_cleared_at_the_next_start_and_a_missing_project_leaves_no_folder() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(on_overleaf()).await;
        let alice = mock.user("alice");
        signed_in_as(&mock.base, &alice);
        let before = crate::project::list_projects_blocking().unwrap().len();
        let refused = import::open_live(&mock.base, None, "6af9ffffffffffffffffffff")
            .await
            .unwrap_err();
        assert!(
            refused.contains("overleaf.project_unavailable"),
            "{refused}"
        );
        assert_eq!(
            crate::project::list_projects_blocking().unwrap().len(),
            before
        );

        let OpenedLive { project_id, .. } = import::open_live(&mock.base, None, &mock.project_id())
            .await
            .unwrap();
        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        eventually("the open finishes", || {
            told(&host, |notice| matches!(notice, OverleafNotice::Filled))
        })
        .await;
        crate::collab::live::stop(&project_id).await;
        let mirror = mirror_of(&mock, &alice, &project_id);
        opening::mark(&mirror).unwrap();

        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        eventually("the leftover mark goes", || !opening::marked(&mirror)).await;
        assert!(told(&host, |notice| matches!(
            notice,
            OverleafNotice::Filling { done: 2, total: 2 }
        )));
        crate::collab::live::stop(&project_id).await;
        assert!(live_now(&project_id).is_none());
    });
    drop(library);
}

#[test]
fn an_edit_made_while_live_was_off_merges_with_a_coauthors_at_the_next_start() {
    let library = TempLibrary::new();
    run(async {
        let project = on_overleaf().member(MockUser::named("bob"), Privilege::ReadAndWrite);
        let mock = MockOverleaf::start(project).await;
        let alice = mock.user("alice");
        signed_in_as(&mock.base, &alice);
        let OpenedLive { project_id, .. } = import::open_live(&mock.base, None, &mock.project_id())
            .await
            .unwrap();
        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        eventually("the open finishes", || {
            told(&host, |notice| matches!(notice, OverleafNotice::Filled))
        })
        .await;
        crate::collab::live::stop(&project_id).await;

        let root = crate::paths::project_dir(&project_id).unwrap();
        std::fs::write(root.join(INTRO), "Intro\nmine\n").unwrap();
        std::fs::write(root.join("notes.tex"), "Notes\n").unwrap();
        let intro = mock.doc_id(INTRO);
        let mut bob = mock.peer("bob");
        bob.join(&intro);
        bob.type_at(&intro, 0, "Theirs\n");

        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        let merged = "Theirs\nIntro\nmine\n";
        eventually("both edits are online and in the folder", || {
            mock.doc_text(&intro) == merged
                && on_disk(&project_id, INTRO).as_deref() == Some(merged.as_bytes())
        })
        .await;
        eventually("the new file is online", || {
            mock.entity_id("notes.tex")
                .is_some_and(|notes| mock.doc_text(&notes) == "Notes\n")
        })
        .await;
        assert!(host
            .tree
            .lock()
            .unwrap()
            .iter()
            .all(|notice| !matches!(notice.kind, TreeNoticeKind::NotAllowed { .. })));
        crate::collab::live::stop(&project_id).await;
    });
    drop(library);
}

fn local_project(files: &[(&str, &[u8])]) -> String {
    let project_id = crate::project::create_blank_project("Local paper".into()).unwrap();
    let root = crate::paths::project_dir(&project_id).unwrap();
    for (path, bytes) in files {
        let target = root.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, bytes).unwrap();
    }
    project_id
}

fn existing() -> MockProject {
    MockProject::new("Existing").doc("old.tex", "old")
}

#[test]
fn putting_a_project_on_overleaf_links_it_only_after_overleaf_confirms() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(existing()).await;
        let alice = mock.user("alice");
        signed_in_as(&mock.base, &alice);
        let project_id = local_project(&[
            ("refs.bib", b"@book{a}\n"),
            ("figures/pixel.png", PNG),
            ("main.aux", b"built"),
            (".env", b"SECRET=1"),
        ]);
        mock.plan_fault(
            Some("POST"),
            "/project/new/upload",
            Fault::Delay(Duration::from_millis(600)),
        );
        let creating = {
            let (id, base) = (project_id.clone(), mock.base.clone());
            tokio::spawn(async move { create::create_from_local(&id, &base, None, None).await })
        };
        eventually("the upload is sent", || {
            !mock.requests("/project/new/upload").is_empty()
        })
        .await;
        assert!(meta_of(&project_id).get("importedFrom").is_none());
        let created = creating.await.unwrap().unwrap();
        assert_eq!(created.remote_id, mock.project_id());
        assert_eq!(created.name, "Local paper");
        assert_eq!(mock.project_name(), "Local paper");
        assert_eq!(mock.root_doc_path().as_deref(), Some(MAIN));
        assert_eq!(mock.requests("/project/new/upload").len(), 1);
        let entries = &mock.created()[0].entries;
        assert_eq!(entries, &["figures/pixel.png", "main.tex", "refs.bib"]);
        let meta = meta_of(&project_id);
        assert_eq!(
            meta["importedFrom"]["projectId"],
            mock.project_id().as_str()
        );
        assert_eq!(meta["importedFrom"]["userId"], alice.id.as_str());
        assert_eq!(meta["main_doc"], MAIN);
        let bases: serde_json::Value = serde_json::from_slice(
            &std::fs::read(mirror_of(&mock, &alice, &project_id).join(IMPORT_BASES)).unwrap(),
        )
        .unwrap();
        assert_eq!(bases["refs.bib"], "@book{a}\n");
        assert!(bases.get("figures/pixel.png").is_none());

        let host = Arc::new(Quiet::default());
        go_live(&host, &project_id).await;
        eventually("every doc is live", || {
            mock.has_joined_and_listed_users(&alice.id, &mock.doc_id(MAIN))
                && mock.has_joined_and_listed_users(&alice.id, &mock.doc_id("refs.bib"))
        })
        .await;
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert!(!told(&host, |notice| matches!(
            notice,
            OverleafNotice::NeedsReview { .. } | OverleafNotice::Merged { .. }
        )));
        assert!(mock.received("applyOtUpdate").is_empty());
        crate::collab::live::stop(&project_id).await;
    });
    drop(library);
}

#[test]
fn a_lost_reply_is_settled_from_the_project_list_and_never_uploaded_twice() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(existing()).await;
        signed_in_as(&mock.base, &mock.user("alice"));
        let project_id = local_project(&[]);
        mock.plan_fault(Some("POST"), "/project/new/upload", Fault::LoseReply);
        let created = create::create_from_local(&project_id, &mock.base, None, Some("Renamed"))
            .await
            .unwrap();
        assert_eq!(created.remote_id, mock.project_id());
        assert_eq!(mock.requests("/project/new/upload").len(), 1);
        assert_eq!(mock.project_name(), "Renamed");
        assert_eq!(
            meta_of(&project_id)["importedFrom"]["projectId"],
            mock.project_id().as_str()
        );

        let other = local_project(&[]);
        for (status, body, code) in [
            (
                500,
                "{\"success\":false,\"error\":\"upload_failed\"}",
                "overleaf.create_refused",
            ),
            (500, "<html></html>", "overleaf.unreachable"),
            (502, "Bad gateway", "overleaf.create_unconfirmed"),
        ] {
            mock.plan_fault(
                Some("POST"),
                "/project/new/upload",
                Fault::Reply(status, body.into()),
            );
            let failed = create::create_from_local(&other, &mock.base, None, None)
                .await
                .unwrap_err();
            assert!(failed.contains(code), "{status} {body}: {failed}");
            assert_eq!(failed.contains("upload_failed"), body.contains("upload"));
            assert!(meta_of(&other).get("importedFrom").is_none());
        }

        mock.plan_fault(Some("GET"), "/project", Fault::Delay(Duration::ZERO));
        mock.plan_fault(Some("GET"), "/project", Fault::Reply(503, "down".into()));
        mock.plan_fault(Some("POST"), "/project/new/upload", Fault::LoseReply);
        let unconfirmed = create::create_from_local(&other, &mock.base, None, None)
            .await
            .unwrap_err();
        assert!(
            unconfirmed.contains("overleaf.create_unconfirmed"),
            "{unconfirmed}"
        );
        assert!(meta_of(&other).get("importedFrom").is_none());
    });
    drop(library);
}

#[test]
fn a_project_that_cannot_go_on_overleaf_is_refused_before_anything_is_sent() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(existing()).await;
        signed_in_as(&mock.base, &mock.user("alice"));
        let base = mock.base.clone();
        let refusal = |id: String| {
            let base = base.clone();
            async move {
                create::create_from_local(&id, &base, None, None)
                    .await
                    .unwrap_err()
            }
        };

        let linked = local_project(&[]);
        let mut meta = crate::project::read_meta(&linked).unwrap();
        meta.extra.insert(
            "importedFrom".into(),
            serde_json::json!({ "service": "overleaf", "server": mock.base, "projectId": mock.project_id() }),
        );
        crate::project::write_meta(&linked, &meta).unwrap();
        assert!(refusal(linked)
            .await
            .contains("overleaf.sync_already_linked"));

        let shared = local_project(&[]);
        let _binding = crate::collab::testing::share(&shared);
        assert!(refusal(shared).await.contains("overleaf.create_shared"));

        let folded = local_project(&[]);
        let root = crate::paths::project_dir(&folded).unwrap();
        std::fs::create_dir_all(root.join("paper")).unwrap();
        std::fs::rename(root.join(MAIN), root.join("paper").join(MAIN)).unwrap();
        assert!(refusal(folded).await.contains("overleaf.create_one_folder"));
        assert!(mock.requests("/project/new/upload").is_empty());

        mock.plan_fault(
            Some("POST"),
            "/project/new/upload",
            Fault::Reply(
                422,
                r#"{"success":false,"error":"Invalid zip file"}"#.into(),
            ),
        );
        let refused = refusal(local_project(&[])).await;
        assert!(refused.contains("overleaf.create_refused"), "{refused}");
        assert!(refused.contains("Invalid zip file"), "{refused}");
    });
    drop(library);
}

fn shared_paper() -> MockProject {
    MockProject::new("Shared paper")
        .outsider(MockUser::named("erin"))
        .outsider(MockUser::named("dave"))
        .doc(MAIN, "Hello")
        .invited("dave@example.test", Privilege::ReadAndWrite)
}

#[test]
fn a_share_link_shows_what_joining_grants_and_joins_only_when_asked() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(shared_paper()).await;
        signed_in_as(&mock.base, &mock.user("erin"));
        let (read, edit) = mock.share_by_link();
        let server = Some(mock.base.clone());
        let shown = links::overleaf_link_preview(server.clone(), None, read.clone())
            .await
            .unwrap();
        assert_eq!(shown.grants, links::Grants::View);
        assert_eq!(shown.project_name.as_deref(), Some("Shared paper"));
        assert_eq!(mock.privilege_of("erin"), None);
        assert!(mock
            .grants()
            .iter()
            .all(|body| body.get("confirmedByUser").is_none()));

        let joined = links::overleaf_link_join(server.clone(), None, read.clone())
            .await
            .unwrap();
        assert_eq!(joined.project_id, mock.project_id());
        assert_eq!(mock.privilege_of("erin"), Some(Privilege::ReadOnly));
        let already = links::overleaf_link_preview(server.clone(), None, read)
            .await
            .unwrap();
        assert_eq!(already.grants, links::Grants::Already);
        assert_eq!(already.project_id, Some(mock.project_id()));

        let upgrade = links::overleaf_link_preview(server.clone(), None, edit.clone())
            .await
            .unwrap();
        assert_eq!(upgrade.grants, links::Grants::Edit);
        links::overleaf_link_join(server.clone(), None, edit)
            .await
            .unwrap();
        assert_eq!(mock.privilege_of("erin"), Some(Privilege::ReadAndWrite));

        let foreign = links::overleaf_link_preview(
            server.clone(),
            None,
            "https://evil.example/read/qwertyuiopas".into(),
        )
        .await
        .unwrap_err();
        assert!(foreign.contains("overleaf.link_invalid"), "{foreign}");
        let gone =
            links::overleaf_link_preview(server, None, format!("{}/read/abcdefghijkl", mock.base))
                .await
                .unwrap_err();
        assert!(gone.contains("overleaf.link_unavailable"), "{gone}");
    });
    drop(library);
}

#[test]
fn an_invitation_is_listed_then_accepted_and_leaves_the_list() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(shared_paper()).await;
        signed_in_as(&mock.base, &mock.user("dave"));
        let server = Some(mock.base.clone());
        let listed = super::overleaf_list_projects(server.clone(), None)
            .await
            .unwrap();
        assert!(listed.projects.is_empty());
        assert_eq!(listed.invites.len(), 1);
        let shown = serde_json::to_value(&listed.invites[0]).unwrap();
        assert_eq!(shown["projectName"], "Shared paper");
        assert_eq!(shown["inviter"], "Alice");
        assert!(shown.get("token").is_none());

        let joined =
            links::overleaf_invite_accept(server.clone(), None, listed.invites[0].id.clone())
                .await
                .unwrap();
        assert_eq!(joined.project_id, mock.project_id());
        assert_eq!(mock.privilege_of("dave"), Some(Privilege::ReadAndWrite));
        let after = super::overleaf_list_projects(server.clone(), None)
            .await
            .unwrap();
        assert_eq!(after.projects.len(), 1);
        assert!(after.invites.is_empty());
        let stale = links::overleaf_invite_accept(server, None, listed.invites[0].id.clone())
            .await
            .unwrap_err();
        assert!(stale.contains("overleaf.link_unavailable"), "{stale}");
    });
    drop(library);
}
