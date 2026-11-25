use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::{CollabError, CollabPaths};
use oleafly_online::live::journal::{DocRecord, Journal, ProjectManifest, SCHEMA};
use oleafly_online::realtime::DocId;
use oleafly_online::test_support::mock_overleaf::{MockOverleaf, MockProject, MockUser, Privilege};

use super::account::overleaf_signed_in;
use super::commands::{live_now, live_project, start};
use super::rig::{eventually, run, session_of, OverleafRig, Quiet};
use crate::collab::live::lifecycle::stop;
use crate::collab::testing::TempLibrary;

const MAIN: &str = "main.tex";
const SERVER: &str = "https://www.overleaf.com";

fn project() -> MockProject {
    MockProject::new("accounts")
        .member(MockUser::named("bob"), Privilege::ReadAndWrite)
        .doc(MAIN, "Hello\n")
}

fn collab_paths() -> CollabPaths {
    CollabPaths::new(crate::paths::collab_root().unwrap())
}

fn linked_as(server: &str, remote: &str, user: Option<&MockUser>) -> String {
    let project_id = crate::project::create_blank_project("Imported".into()).unwrap();
    let mut meta = crate::project::read_meta(&project_id).unwrap();
    let mut origin =
        serde_json::json!({ "service": "overleaf", "server": server, "projectId": remote });
    if let Some(user) = user {
        origin["userId"] = user.id.clone().into();
        origin["email"] = user.email.clone().into();
    }
    meta.extra.insert("importedFrom".to_owned(), origin);
    crate::project::write_meta(&project_id, &meta).unwrap();
    project_id
}

fn signed_in_as(base: &str, user: &MockUser) {
    let store = crate::secrets::store().unwrap();
    oleafly_online::session::save(&store, base, &session_of(user)).unwrap();
}

fn recorded_user(project_id: &str) -> Option<String> {
    let meta = crate::project::read_meta(project_id).unwrap();
    meta.extra
        .get("importedFrom")?
        .get("userId")?
        .as_str()
        .map(str::to_owned)
}

async fn go_live(project_id: &str) -> Result<(), CollabError> {
    start(Arc::new(Quiet::default()), &collab_paths(), project_id)
        .await
        .map(drop)
}

fn joined_as(mock: &MockOverleaf, user: &MockUser) -> bool {
    mock.connections()
        .iter()
        .any(|connection| connection.user_id.as_deref() == Some(user.id.as_str()))
}

#[test]
fn two_accounts_one_server_each_project_uses_its_own() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(project()).await;
        let (alice, bob) = (mock.user("alice"), mock.user("bob"));
        let bobs = linked_as(&mock.base, &mock.project_id(), Some(&bob));
        let alices = linked_as(&mock.base, &mock.project_id(), Some(&alice));
        signed_in_as(&mock.base, &bob);
        signed_in_as(&mock.base, &alice);

        go_live(&bobs).await.unwrap();
        let live = live_now(&bobs).unwrap();
        assert_eq!(live.account(), bob.id);
        assert_eq!(live.owner(), Some(bob.id.as_str()));
        eventually("bob joins the project", || joined_as(&mock, &bob)).await;
        assert!(!joined_as(&mock, &alice));
        let shown = live_project(&bobs).unwrap().unwrap();
        assert!(shown.signed_in);
        assert_eq!(
            shown
                .account
                .as_ref()
                .map(|account| account.user_id.as_str()),
            Some(bob.id.as_str())
        );
        drop(live);
        stop(&bobs).await;

        go_live(&alices).await.unwrap();
        assert_eq!(live_now(&alices).unwrap().account(), alice.id);
        eventually("alice joins the project", || joined_as(&mock, &alice)).await;
        stop(&alices).await;

        let store = crate::secrets::store().unwrap();
        oleafly_online::session::forget_account(&store, &mock.base, &bob.id).unwrap();
        let shown = live_project(&bobs).unwrap().unwrap();
        assert!(!shown.signed_in);
        assert_eq!(
            shown.account.and_then(|account| account.email),
            Some(bob.email.clone())
        );
        assert!(live_project(&alices).unwrap().unwrap().signed_in);
        let refused = go_live(&bobs).await.unwrap_err();
        assert!(
            matches!(&refused, CollabError::Api { code, .. } if code == "signed_out"),
            "{refused:?}"
        );
        assert!(live_now(&bobs).is_none());
    });
    drop(library);
}

#[test]
fn signing_in_another_account_leaves_the_live_project_alone() {
    let library = TempLibrary::new();
    run(async {
        let mock = MockOverleaf::start(project()).await;
        let (alice, bob) = (mock.user("alice"), mock.user("bob"));
        let unrecorded = linked_as(&mock.base, &mock.project_id(), None);
        signed_in_as(&mock.base, &alice);

        go_live(&unrecorded).await.unwrap();
        let live = live_now(&unrecorded).unwrap();
        eventually("the first good start records alice", || {
            recorded_user(&unrecorded).as_deref() == Some(alice.id.as_str())
        })
        .await;
        eventually("the live project knows its account", || {
            live.owner() == Some(alice.id.as_str())
        })
        .await;
        let meta = crate::project::read_meta(&unrecorded).unwrap();
        assert_eq!(meta.extra["importedFrom"]["email"], alice.email.as_str());

        signed_in_as(&mock.base, &bob);
        overleaf_signed_in(&mock.base, &session_of(&bob)).unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
        assert_eq!(live.account(), alice.id);
        assert!(!joined_as(&mock, &bob));
        assert_eq!(
            recorded_user(&unrecorded).as_deref(),
            Some(alice.id.as_str())
        );
        drop(live);
        stop(&unrecorded).await;
    });
    drop(library);
}

#[test]
fn an_unrecorded_live_project_still_follows_a_new_sign_in() {
    run(async {
        let rig = OverleafRig::start(project(), &[(MAIN, "Hello\n")]).await;
        let bob = rig.mock.user("bob");
        assert_eq!(rig.live.owner(), None);
        assert_eq!(rig.live.account(), rig.mock.user("alice").id);
        overleaf_signed_in(&rig.mock.base, &session_of(&bob)).unwrap();
        assert_eq!(rig.live.account(), bob.id);
        eventually("bob joins after the switch", || joined_as(&rig.mock, &bob)).await;
        rig.finish().await;
    });
}

fn journal_with_unsent(server: &str, remote: &str, user: &MockUser, path: &str) {
    let data = crate::paths::oleafly_root().unwrap();
    let mut journal = Journal::open(&data, server, remote, None).unwrap();
    journal.set_manifest(ProjectManifest {
        user_id: user.id.clone(),
        ..ProjectManifest::default()
    });
    journal.put(
        &DocId("aaaaaaaaaaaaaaaaaaaaaaaa".to_owned()),
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

#[test]
fn sign_out_of_one_account_reports_only_its_unsent_work() {
    let library = TempLibrary::new();
    let (alice, bob) = (MockUser::named("alice"), MockUser::named("bob"));
    let (first, second) = ("64f0c0ffee0123456789aaa1", "64f0c0ffee0123456789aaa2");
    let alices = linked_as(SERVER, first, Some(&alice));
    let bobs = linked_as(SERVER, second, Some(&bob));
    journal_with_unsent(SERVER, first, &alice, "chapter.tex");
    journal_with_unsent(SERVER, second, &bob, "notes.tex");
    signed_in_as(SERVER, &alice);
    signed_in_as(SERVER, &bob);
    let listed = |unsent: &[crate::collab::live::UnsentProject]| -> Vec<(String, Vec<String>)> {
        unsent
            .iter()
            .map(|project| (project.project_id.clone(), project.paths.clone()))
            .collect()
    };
    let users = |status: &crate::overleaf::OverleafStatus| -> Vec<String> {
        status
            .accounts
            .iter()
            .map(|account| account.user_id.clone())
            .collect()
    };
    run(async {
        let sign_out = |user: &str, keep: bool| {
            crate::overleaf::sign_out_within(
                SERVER.to_owned(),
                Some(user.to_owned()),
                keep,
                Duration::from_millis(300),
            )
        };
        let asked = sign_out(&alice.id, false).await.unwrap();
        assert_eq!(
            listed(&asked.unsent),
            vec![(alices.clone(), vec!["chapter.tex".to_owned()])]
        );
        assert_eq!(users(&asked.status), vec![bob.id.clone(), alice.id.clone()]);

        let asked = sign_out(&bob.id, false).await.unwrap();
        assert_eq!(
            listed(&asked.unsent),
            vec![(bobs.clone(), vec!["notes.tex".to_owned()])]
        );

        let out = sign_out(&alice.id, true).await.unwrap();
        assert!(out.status.signed_in);
        assert_eq!(out.status.user_id.as_deref(), Some(bob.id.as_str()));
        assert_eq!(users(&out.status), vec![bob.id.clone()]);
        assert_eq!(
            listed(&out.unsent),
            vec![(alices.clone(), vec!["chapter.tex".to_owned()])]
        );
    });
    drop(library);
}

#[test]
fn choosing_an_account_makes_it_the_current_one() {
    let library = TempLibrary::new();
    let (alice, bob) = (MockUser::named("alice"), MockUser::named("bob"));
    signed_in_as(SERVER, &alice);
    signed_in_as(SERVER, &bob);
    run(async {
        let status = crate::overleaf::overleaf_status(Some(SERVER.to_owned()))
            .await
            .unwrap();
        assert_eq!(status.user_id.as_deref(), Some(bob.id.as_str()));
        assert_eq!(status.email.as_deref(), Some(bob.email.as_str()));
        let chosen =
            crate::overleaf::overleaf_use_account(Some(SERVER.to_owned()), alice.id.clone())
                .await
                .unwrap();
        assert_eq!(
            serde_json::to_value(&chosen).unwrap(),
            serde_json::json!({
                "server": SERVER,
                "signedIn": true,
                "email": alice.email,
                "userId": alice.id,
                "accounts": [
                    { "userId": alice.id, "email": alice.email },
                    { "userId": bob.id, "email": bob.email },
                ],
            })
        );
        let sign_ins = crate::overleaf::overleaf_sign_ins().await.unwrap();
        assert!(sign_ins.iter().all(|sign_in| {
            sign_in.server == SERVER
                && sign_in.signed_in_at.is_some()
                && sign_in.current == (sign_in.user_id == alice.id)
        }));
        assert_eq!(sign_ins.len(), 2);
        let unknown =
            crate::overleaf::overleaf_use_account(Some(SERVER.to_owned()), "nobody".to_owned())
                .await
                .unwrap_err();
        assert!(unknown.contains("\"overleaf.signed_out\""), "{unknown}");
    });
    drop(library);
}
