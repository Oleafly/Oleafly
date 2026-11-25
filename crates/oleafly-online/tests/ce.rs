use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use oleafly_online::archive;
use oleafly_online::client::Http;
use oleafly_online::live::doc::ChangeSpan;
use oleafly_online::live::format::{new_thread_id, ChangeKind, Decision, DocFormat};
use oleafly_online::live::rest::{
    accept_invite, create_project, grant_token, parse_link, preview_token, DocAtVersion,
    HistoryError, ProjectLink, RestError, SettingsUpdate, TokenReply, TreeOp,
};
use oleafly_online::live::session::linked::LinkedError;
use oleafly_online::live::session::{
    LiveEnd, LivePeer, LiveState, ModeLock, ReviewWriteError, SessionTuning, Standing, TrackScope,
};
use oleafly_online::projects;
use oleafly_online::realtime::connection::{connect, Carrier, Connection};
use oleafly_online::realtime::events::{DocId, EntityId, ProjectEvent};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::{NodeKind, OverleafNode};
use oleafly_online::realtime::ProjectPage;
use oleafly_online::session::{self, SessionHandle};
use oleafly_online::test_support::ce::{
    append, eventually, handle_of, insert_before, joined, label, live, now_ms, offset, open,
    opened, quick, scratch, session_of, start, until, Ce, Live, Scratch, Web, AGENT, MAIN, TURN,
    WAIT,
};
use oleafly_ot::testing::{deletion, insertion};
use oleafly_ot::utf16_len;
use oleafly_secrets::SecretStore;
use serde_json::{json, Value};

const SHARED: &str = "sharejs-project";
const HISTORY_OT: &str = "history-ot-project";
const BIB: &str = "sample.bib";

fn seeded(format: DocFormat) -> &'static str {
    match format {
        DocFormat::ShareJs => SHARED,
        DocFormat::HistoryOt => HISTORY_OT,
    }
}

fn seeded_project(ce: &Ce, name: &str) -> String {
    ce.state["projects"][name]["id"]
        .as_str()
        .unwrap()
        .to_string()
}

fn seeded_doc(ce: &Ce, project: &str, path: &str) -> DocId {
    DocId(
        ce.state["projects"][project]["docs"][path]
            .as_str()
            .unwrap()
            .to_string(),
    )
}

fn reseed(ce: &Ce) {
    let status = std::process::Command::new(ce.dir.join("up.sh"))
        .stdout(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success(), "the seed did not run");
}

fn tracked_changes(ce: &Ce, project: &str, doc: &DocId) -> Vec<Value> {
    ce.doc_state(project, doc, false)["ranges"]["changes"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn comments(ce: &Ce, project: &str, doc: &DocId) -> Vec<Value> {
    let state = ce.doc_state(project, doc, true);
    let listed = if state["lines"].is_array() {
        &state["ranges"]["comments"]
    } else {
        &state["lines"]["comments"]
    };
    listed.as_array().cloned().unwrap_or_default()
}

async fn set_privilege(web: &mut Web, project: &str, user: &str, level: &str) {
    let path = format!("/project/{project}/users/{user}");
    let (status, _) = web
        .call(
            reqwest::Method::PUT,
            &path,
            Some(json!({ "privilegeLevel": level })),
        )
        .await;
    assert_eq!(status, 204, "changing the role to {level}");
}

async fn remove_member(web: &mut Web, project: &str, user: &str) {
    let path = format!("/project/{project}/users/{user}");
    let (status, _) = web.call(reqwest::Method::DELETE, &path, None).await;
    assert_eq!(status, 204, "removing {user}");
}

async fn share_by_link(web: &mut Web, project: &str, on: bool) {
    let level = if on { "tokenBased" } else { "private" };
    let path = format!("/project/{project}/settings/admin");
    let (status, _) = web
        .call(
            reqwest::Method::POST,
            &path,
            Some(json!({ "publicAccessLevel": level })),
        )
        .await;
    assert_eq!(status, 204, "link sharing {level}");
}

async fn tokens(web: &mut Web, project: &str) -> Value {
    let (status, tokens) = web
        .call(
            reqwest::Method::GET,
            &format!("/project/{project}/tokens"),
            None,
        )
        .await;
    assert_eq!(status, 200);
    tokens
}

async fn join_by_link(web: &mut Web, token: &str) {
    let path = format!("/read/{token}/grant");
    let (status, reply) = web
        .call(
            reqwest::Method::POST,
            &path,
            Some(json!({ "confirmedByUser": true })),
        )
        .await;
    assert_eq!(status, 200, "{reply}");
}

async fn delete_project(web: &mut Web, project: &str) {
    let (status, _) = web
        .call(
            reqwest::Method::DELETE,
            &format!("/project/{project}"),
            None,
        )
        .await;
    assert_eq!(status, 200, "deleting {project}");
}

async fn flush(web: &mut Web, project: &str) {
    let (status, _) = web
        .call(
            reqwest::Method::POST,
            &format!("/project/{project}/flush"),
            None,
        )
        .await;
    assert!(matches!(status, 200 | 204), "flushing history: {status}");
}

async fn add_doc(web: &mut Web, project: &str, name: &str, parent: &EntityId) -> DocId {
    let body = json!({ "name": name, "parent_folder_id": parent.0 });
    let (status, reply) = web
        .call(
            reqwest::Method::POST,
            &format!("/project/{project}/doc"),
            Some(body),
        )
        .await;
    assert_eq!(status, 200, "adding {name}: {reply}");
    DocId(reply["_id"].as_str().unwrap().to_string())
}

async fn delete_doc(web: &mut Web, project: &str, doc: &DocId) {
    let path = format!("/project/{project}/doc/{}", doc.0);
    let (status, _) = web.call(reqwest::Method::DELETE, &path, None).await;
    assert_eq!(status, 204, "deleting a doc");
}

async fn settings(web: &mut Web, project: &str, body: Value) {
    let path = format!("/project/{project}/settings");
    let (status, reply) = web.call(reqwest::Method::POST, &path, Some(body)).await;
    assert_eq!(status, 204, "changing settings: {reply}");
}

async fn invite(web: &mut Web, project: &str, email: &str, privileges: &str) -> String {
    let body = json!({ "email": email, "privileges": privileges });
    let path = format!("/project/{project}/invite");
    let (status, reply) = web.call(reqwest::Method::POST, &path, Some(body)).await;
    assert_eq!(status, 200, "inviting someone: {reply}");
    reply["invite"]["_id"].as_str().unwrap().to_string()
}

async fn revoke_invite(web: &mut Web, project: &str, invite: &str) {
    let path = format!("/project/{project}/invite/{invite}");
    let (status, _) = web.call(reqwest::Method::DELETE, &path, None).await;
    assert_eq!(status, 204, "revoking an invite");
}

async fn link_file(
    web: &mut Web,
    target: &str,
    name: &str,
    parent: &EntityId,
    source: &str,
    path: &str,
) -> EntityId {
    let body = json!({
        "name": name,
        "parent_folder_id": parent.0,
        "provider": "project_file",
        "data": { "source_project_id": source, "source_entity_path": path },
    });
    let route = format!("/project/{target}/linked_file");
    let (status, reply) = web.call(reqwest::Method::POST, &route, Some(body)).await;
    assert_eq!(status, 200, "linking {path}: {reply}");
    EntityId(reply["new_file_id"].as_str().unwrap().to_string())
}

async fn can_read(web: &mut Web, project: &str) -> bool {
    let path = format!("/project/{project}/entities");
    web.call(reqwest::Method::GET, &path, None).await.0 == 200
}

async fn seeded_roles(ce: &Ce, owner: &mut Web) {
    let project = seeded_project(ce, SHARED);
    for (who, level) in [
        ("bob", "readAndWrite"),
        ("carol", "review"),
        ("dave", "readOnly"),
    ] {
        let path = format!("/project/{project}/users/{}", ce.user_id(who));
        let (status, _) = owner
            .call(
                reqwest::Method::PUT,
                &path,
                Some(json!({ "privilegeLevel": level })),
            )
            .await;
        if status != 204 {
            reseed(ce);
            return;
        }
    }
}

async fn remove_suffix(live: &Live, doc: &DocId, text: &str) {
    let removed = live
        .session
        .local_edit_with(doc, |current| {
            let end = utf16_len(current);
            current
                .ends_with(text)
                .then(|| deletion(end, end - utf16_len(text), utf16_len(text)))
        })
        .unwrap();
    assert!(removed, "the test's text was still at the end");
    assert!(live.session.settle(WAIT).await);
}

async fn delete_text(live: &Live, doc: &DocId, needle: &str) {
    let removed = live
        .session
        .local_edit_with(doc, |current| {
            Some(deletion(
                utf16_len(current),
                offset(current, needle),
                utf16_len(needle),
            ))
        })
        .unwrap();
    assert!(removed);
    assert!(live.session.settle(WAIT).await, "the delete was confirmed");
}

fn ended(live: &Live) -> Option<LiveEnd> {
    live.watch
        .seen()
        .states
        .iter()
        .rev()
        .find_map(|state| match state {
            LiveState::Ended(end) => Some(end.clone()),
            _ => None,
        })
}

fn role(live: &Live) -> Option<(Role, bool)> {
    live.watch.seen().roles.last().cloned()
}

fn sightings(live: &Live, user: &str) -> Vec<LivePeer> {
    live.watch
        .seen()
        .peers
        .iter()
        .filter(|peer| peer.user_id.as_deref() == Some(user))
        .cloned()
        .collect()
}

fn heard(live: &Live, event: &ProjectEvent) -> bool {
    live.watch.seen().events.contains(event)
}

fn node(live: &Live, name: &str) -> Option<OverleafNode> {
    live.session
        .nodes()
        .into_iter()
        .find(|node| node.name == name)
}

fn root_folder(live: &Live) -> EntityId {
    node(live, MAIN)
        .and_then(|main| main.parent)
        .expect("main.tex sits in the root folder")
}

async fn probed(live: &Live) {
    until("the review and chat probes are done", || {
        live.session.review_support().probed && live.session.chat_support().probed
    })
    .await;
}

struct Peer {
    connection: Connection,
}

impl Peer {
    async fn join(ce: &Ce, web: &Web, project: &str) -> Peer {
        let http = Http::new(&ce.site, AGENT).unwrap();
        let handle = handle_of(ce, &http, web).await;
        let page = ProjectPage::load(&http, &handle, project, false)
            .await
            .unwrap();
        let carriers = [Carrier::WebSocket, Carrier::XhrPolling];
        let (connection, _) = tokio::time::timeout(WAIT, connect(&http, &handle, &page, &carriers))
            .await
            .expect("the peer connected in time")
            .unwrap();
        Peer { connection }
    }

    async fn ask(&self, name: &'static str, args: Vec<Value>) -> Vec<Value> {
        let reply = tokio::time::timeout(WAIT, self.connection.call(name, args))
            .await
            .unwrap_or_else(|_| panic!("{name} got no reply"))
            .unwrap();
        assert!(
            reply.first().is_none_or(Value::is_null),
            "{name} was refused: {reply:?}"
        );
        reply
    }

    async fn send(&self, doc: &DocId, op: Value) {
        let options = json!({ "encodeRanges": true, "supportsHistoryOT": true });
        let joined = self.ask("joinDoc", vec![json!(doc.0), options]).await;
        let version = joined[2].as_u64().expect("a doc version");
        let update = json!({ "doc": doc.0, "op": op, "v": version });
        self.ask("applyOtUpdate", vec![json!(doc.0), update]).await;
        self.ask("leaveDoc", vec![json!(doc.0)]).await;
    }

    async fn close(self) {
        self.connection.close().await;
    }
}

macro_rules! on_both {
    ($gate:ident, $sharejs:ident, $history:ident) => {
        #[tokio::test(flavor = "multi_thread")]
        async fn $sharejs() {
            let _turn = TURN.lock().await;
            $gate(DocFormat::ShareJs).await;
        }

        #[tokio::test(flavor = "multi_thread")]
        async fn $history() {
            let _turn = TURN.lock().await;
            $gate(DocFormat::HistoryOt).await;
        }
    };
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_presence_reaches_coauthors_and_stays_while_they_read() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = seeded_project(&ce, SHARED);
    let (alice_web, bob_web) = (
        Web::sign_in(&ce, "alice").await,
        Web::sign_in(&ce, "bob").await,
    );
    let alice = live(&ce, &alice_web, &project, quick()).await;
    let bob = live(&ce, &bob_web, &project, quick()).await;
    let main = seeded_doc(&ce, SHARED, MAIN);
    assert_eq!(open(&alice, MAIN), main);
    open(&bob, MAIN);
    joined(&alice, &main).await;
    joined(&bob, &main).await;
    let alice_id = ce.user_id("alice");

    alice.session.presence(Some((main.clone(), 3)));
    until("bob sees alice's caret", || {
        sightings(&bob, &alice_id).iter().any(|peer| {
            peer.doc.as_ref() == Some(&main)
                && peer.offset == Some(3)
                && peer.name.as_deref() == Some("Alice Owner")
        })
    })
    .await;
    let before = sightings(&bob, &alice_id).len();
    until("alice stays visible while she only reads", || {
        sightings(&bob, &alice_id).len() >= before + 3
    })
    .await;
    assert!(sightings(&bob, &alice_id)
        .iter()
        .skip(before)
        .all(|peer| peer.offset == Some(3)));

    alice.session.presence(Some((main.clone(), 7)));
    until("bob sees alice move", || {
        sightings(&bob, &alice_id)
            .last()
            .is_some_and(|peer| peer.offset == Some(7))
    })
    .await;
    assert!(
        sightings(&alice, &alice_id).is_empty(),
        "alice saw her own echo"
    );

    let carol_web = Web::sign_in(&ce, "carol").await;
    let carol = live(&ce, &carol_web, &project, quick()).await;
    until(
        "carol, joining later, already lists alice where she is",
        || {
            sightings(&carol, &alice_id)
                .iter()
                .any(|peer| peer.doc.as_ref() == Some(&main))
        },
    )
    .await;

    let alice_public = sightings(&bob, &alice_id).last().unwrap().id.clone();
    alice.session.stop().await;
    until("bob and carol see alice leave", || {
        bob.watch.seen().left.contains(&alice_public)
            && carol.watch.seen().left.contains(&alice_public)
    })
    .await;
    bob.session.stop().await;
    carol.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_your_other_window_is_a_peer_with_your_id() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = seeded_project(&ce, SHARED);
    let web = Web::sign_in(&ce, "alice").await;
    let first = live(&ce, &web, &project, quick()).await;
    let second = live(&ce, &web, &project, quick()).await;
    let main = seeded_doc(&ce, SHARED, MAIN);
    open(&first, MAIN);
    open(&second, MAIN);
    joined(&first, &main).await;
    joined(&second, &main).await;
    first.session.presence(Some((main.clone(), 2)));
    let alice_id = ce.user_id("alice");
    until("the other window shows as a peer with alice's id", || {
        sightings(&second, &alice_id)
            .iter()
            .any(|peer| peer.offset == Some(2))
    })
    .await;
    first.session.stop().await;
    second.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_a_viewer_sends_nothing() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = seeded_project(&ce, SHARED);
    seeded_roles(&ce, &mut Web::sign_in(&ce, "alice").await).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    assert_eq!(role(&dave), Some((Role::Viewer, false)));
    let main = open(&dave, MAIN);
    joined(&dave, &main).await;
    let refused = dave.session.local_edit_with(&main, |current| {
        let end = utf16_len(current);
        Some(insertion(end, end, " from a viewer"))
    });
    assert!(refused.is_err());
    dave.session.stop().await;
    let alice = live(&ce, &Web::sign_in(&ce, "alice").await, &project, quick()).await;
    let main = open(&alice, MAIN);
    joined(&alice, &main).await;
    assert!(!alice.session.text(&main).unwrap().contains("from a viewer"));
    alice.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_a_role_change_reaches_the_live_session() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = seeded_project(&ce, SHARED);
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    seeded_roles(&ce, &mut alice_web).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    assert_eq!(role(&dave), Some((Role::Viewer, false)));
    let dave_id = ce.user_id("dave");
    set_privilege(&mut alice_web, &project, &dave_id, "readAndWrite").await;
    until("dave can edit", || {
        role(&dave).is_some_and(|(role, _)| role == Role::Editor)
    })
    .await;
    let main = open(&dave, MAIN);
    joined(&dave, &main).await;
    append(&dave, &main, " (dave was here)").await;
    remove_suffix(&dave, &main, " (dave was here)").await;
    set_privilege(&mut alice_web, &project, &dave_id, "readOnly").await;
    until("dave is a viewer again", || {
        role(&dave) == Some((Role::Viewer, false))
    })
    .await;
    assert!(ended(&dave).is_none());
    dave.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_removal_ends_live_as_removed() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = seeded_project(&ce, SHARED);
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    remove_member(&mut alice_web, &project, &ce.user_id("dave")).await;
    until("dave's session ends as removed", || {
        ended(&dave) == Some(LiveEnd::Removed)
    })
    .await;
    dave.session.stop().await;
    reseed(&ce);
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_link_sharing_off_ends_like_removal_and_a_link_viewer_is_restricted() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "link-sharing", DocFormat::ShareJs, &[]).await;
    share_by_link(&mut alice_web, &project.id, true).await;
    let token = tokens(&mut alice_web, &project.id).await["readOnly"]
        .as_str()
        .unwrap()
        .to_string();
    let mut bob_web = Web::sign_in(&ce, "bob").await;
    join_by_link(&mut bob_web, &token).await;
    let bob = live(&ce, &bob_web, &project.id, quick()).await;
    assert_eq!(role(&bob), Some((Role::Viewer, false)));
    assert_eq!(bob.watch.seen().flags.first(), Some(&(true, false)));
    share_by_link(&mut alice_web, &project.id, false).await;
    until("bob's session ends as removed", || {
        ended(&bob) == Some(LiveEnd::Removed)
    })
    .await;
    bob.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_a_deleted_project_ends_live_as_deleted() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "deleted", DocFormat::ShareJs, &[]).await;
    let slow = SessionTuning {
        trickle_every: Duration::from_secs(600),
        ..quick()
    };
    let alice = live(&ce, &alice_web, &project.id, slow).await;
    delete_project(&mut alice_web, &project.id).await;
    for path in [MAIN, BIB] {
        alice.session.open(path, Arc::new(|_| {}));
    }
    until("the session ends as deleted", || {
        ended(&alice) == Some(LiveEnd::ProjectGone)
    })
    .await;
    alice.session.stop().await;
}

async fn comments_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "comments",
        format,
        &[("dave", "readOnly")],
    )
    .await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    let main = opened(&alice, MAIN).await;
    append(&alice, &main, "\nA sentence to comment on.\n").await;
    probed(&alice).await;
    let support = alice.session.review_support();
    assert!(!support.threads && !support.accept_rest && !support.switch_rest);

    let quote = "sentence to comment";
    let text = alice.session.text(&main).unwrap();
    let from = offset(&text, quote);
    let to = from + utf16_len(quote);
    assert_eq!(
        alice.session.comment(&main, from, to, None, "A note").await,
        Err(ReviewWriteError::Absent)
    );
    assert_eq!(
        alice
            .session
            .reply("0123456789abcdef01234567", "A reply")
            .await,
        Err(ReviewWriteError::Absent)
    );
    assert!(alice.session.settle(WAIT).await);
    assert!(comments(&ce, &project.id, &main).is_empty());
    assert!(!alice.session.threads().loaded);

    let thread = new_thread_id().unwrap();
    let op = match format {
        DocFormat::ShareJs => json!([{ "p": from, "c": quote, "t": thread }]),
        DocFormat::HistoryOt => {
            json!([{ "commentId": thread, "ranges": [{ "pos": from, "length": to - from }] }])
        }
    };
    let dave = Peer::join(&ce, &Web::sign_in(&ce, "dave").await, &project.id).await;
    dave.send(&main, op).await;
    dave.close().await;
    let resolved_here = || {
        alice.session.review(&main).and_then(|review| {
            review
                .comments
                .into_iter()
                .find(|comment| comment.thread == thread)
        })
    };
    until("alice sees dave's comment", || {
        resolved_here().is_some_and(|comment| comment.quote == quote)
    })
    .await;
    assert_eq!(alice.session.threads().anchored.get(&thread), Some(&main));
    let counts = alice.session.review_counts();
    assert!(counts
        .iter()
        .any(|(doc, counts)| doc == &main && counts.open == 1 && counts.resolved == 0));

    let on_server = |ce: &Ce| -> Option<Value> {
        comments(ce, &project.id, &main)
            .into_iter()
            .find(|comment| comment["id"] == thread.as_str())
    };
    match format {
        DocFormat::ShareJs => {
            assert_eq!(
                alice.session.set_resolved(&main, &thread, true).await,
                Err(ReviewWriteError::Absent)
            );
            assert_eq!(
                alice.session.delete_thread(&main, &thread).await,
                Err(ReviewWriteError::Absent)
            );
            assert!(on_server(&ce).is_some());
        }
        DocFormat::HistoryOt => {
            alice
                .session
                .set_resolved(&main, &thread, true)
                .await
                .unwrap();
            assert!(alice.session.settle(WAIT).await);
            until("the comment is resolved on the server", || {
                on_server(&ce).is_some_and(|comment| comment["resolved"] == true)
            })
            .await;
            assert_eq!(resolved_here().unwrap().resolved, Some(true));
            alice
                .session
                .set_resolved(&main, &thread, false)
                .await
                .unwrap();
            assert!(alice.session.settle(WAIT).await);
            until("the comment is open again on the server", || {
                on_server(&ce).is_some_and(|comment| comment.get("resolved").is_none())
            })
            .await;
            assert_ne!(resolved_here().unwrap().resolved, Some(true));
            alice.session.delete_thread(&main, &thread).await.unwrap();
            assert!(alice.session.settle(WAIT).await);
            until("the comment is gone on the server", || {
                on_server(&ce).is_none()
            })
            .await;
            until("alice no longer shows it", || resolved_here().is_none()).await;
        }
    }
    alice.session.stop().await;
}

on_both!(
    comments_gate,
    ce_comments_without_the_review_module_on_sharejs,
    ce_comments_without_the_review_module_on_history_ot
);

fn change<'a>(changes: &'a [ChangeSpan], kind: ChangeKind, text: &str) -> &'a ChangeSpan {
    changes
        .iter()
        .find(|change| change.kind == kind && change.text == text)
        .unwrap_or_else(|| panic!("no {kind:?} of {text:?} in {changes:?}"))
}

async fn tracked_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "tracked",
        format,
        &[("carol", "review")],
    )
    .await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    let carol = live(&ce, &Web::sign_in(&ce, "carol").await, &project.id, quick()).await;
    assert_eq!(role(&carol), Some((Role::Reviewer, true)));
    let main = opened(&alice, MAIN).await;
    let line = "Alpha beta gamma delta epsilon zeta eta.";
    append(&alice, &main, &format!("\n{line}\n")).await;
    opened(&carol, MAIN).await;
    until("carol has alice's line", || {
        carol
            .session
            .text(&main)
            .is_some_and(|text| text.contains(line))
    })
    .await;
    probed(&alice).await;
    probed(&carol).await;

    let carol_mode = carol.session.edit_mode();
    assert!(carol_mode.tracking && !carol_mode.switchable);
    assert_eq!(carol_mode.locked, Some(ModeLock::Reviewer));
    let alice_mode = alice.session.edit_mode();
    assert!(!alice_mode.tracking && !alice_mode.switchable && !alice_mode.manage);
    assert_eq!(alice_mode.locked, Some(ModeLock::Server));
    assert_eq!(
        alice.session.set_track_changes(TrackScope::Me, true).await,
        Err(ReviewWriteError::Absent)
    );

    insert_before(&carol, &main, "beta", "NEW ").await;
    delete_text(&carol, &main, "gamma ").await;
    insert_before(&carol, &main, "epsilon", "MORE ").await;
    delete_text(&carol, &main, "zeta ").await;
    let carol_id = ce.user_id("carol");
    until("the server holds carol's four suggestions", || {
        let changes = tracked_changes(&ce, &project.id, &main);
        changes.len() == 4
            && changes
                .iter()
                .all(|change| change["metadata"]["user_id"] == carol_id.as_str())
    })
    .await;
    let (owner, doc) = (&alice, &main);
    let changes = eventually("alice sees the four suggestions", move || async move {
        owner
            .session
            .review(doc)
            .map(|review| review.changes)
            .filter(|changes| changes.len() == 4)
    })
    .await;
    assert!(changes
        .iter()
        .all(|change| change.user.as_deref() == Some(carol_id.as_str())));
    let review = alice.session.review(&main).unwrap();
    assert_eq!(review.format, format);
    assert!(review.can_accept);
    let accept = [
        change(&changes, ChangeKind::Insert, "NEW ").id.clone(),
        change(&changes, ChangeKind::Delete, "gamma ").id.clone(),
    ];
    let reject = [
        change(&changes, ChangeKind::Insert, "MORE ").id.clone(),
        change(&changes, ChangeKind::Delete, "zeta ").id.clone(),
    ];
    assert_eq!(
        alice
            .session
            .decide(&["0123456789abcdef".to_string()], Decision::Accept)
            .await,
        Err(ReviewWriteError::Gone)
    );
    let decided = alice
        .session
        .decide(&accept, Decision::Accept)
        .await
        .unwrap();
    assert!(decided.missing.is_empty());
    assert!(alice.session.settle(WAIT).await);
    until("the accepted suggestions leave the server", || {
        tracked_changes(&ce, &project.id, &main).len() == 2
    })
    .await;
    alice
        .session
        .decide(&reject, Decision::Reject)
        .await
        .unwrap();
    assert!(alice.session.settle(WAIT).await);
    let settled = "Alpha NEW beta delta epsilon zeta eta.";
    until("the rejected suggestions leave the server", || {
        tracked_changes(&ce, &project.id, &main).is_empty()
            && ce.server_text(&project.id, &main).contains(settled)
    })
    .await;
    for live in [&alice, &carol] {
        until("both sessions show the decided text", || {
            live.session
                .text(&main)
                .is_some_and(|text| text.contains(settled))
                && live
                    .session
                    .review(&main)
                    .is_some_and(|review| review.changes.is_empty())
        })
        .await;
    }

    insert_before(&carol, &main, "eta.", "MINE ").await;
    let reviewer = &carol;
    let mine = eventually("carol sees her own suggestion", move || async move {
        reviewer
            .session
            .review(doc)
            .and_then(|review| review.changes.into_iter().next())
    })
    .await;
    let withdrawn = carol
        .session
        .decide(std::slice::from_ref(&mine.id), Decision::Reject)
        .await;
    match format {
        DocFormat::ShareJs => {
            withdrawn.unwrap();
            assert!(carol.session.settle(WAIT).await);
        }
        DocFormat::HistoryOt => {
            assert_eq!(withdrawn, Err(ReviewWriteError::NotAllowed));
            let ids = eventually("alice sees carol's last suggestion", move || async move {
                owner
                    .session
                    .review(doc)
                    .map(|review| {
                        review
                            .changes
                            .into_iter()
                            .map(|change| change.id)
                            .collect::<Vec<_>>()
                    })
                    .filter(|ids| ids.len() == 1)
            })
            .await;
            alice.session.decide(&ids, Decision::Reject).await.unwrap();
            assert!(alice.session.settle(WAIT).await);
        }
    }
    until("the last suggestion is gone from the server", || {
        tracked_changes(&ce, &project.id, &main).is_empty()
            && !ce.server_text(&project.id, &main).contains("MINE")
    })
    .await;
    carol.session.stop().await;
    alice.session.stop().await;
}

on_both!(
    tracked_gate,
    ce_suggestions_are_accepted_and_rejected_by_ops_on_sharejs,
    ce_suggestions_are_accepted_and_rejected_by_ops_on_history_ot
);

async fn live_chat(live: &Live, limit: usize) -> Vec<(String, String, Option<i64>)> {
    live.session
        .chat_page(None, limit)
        .await
        .unwrap()
        .into_iter()
        .filter(|entry| !entry.deleted && !entry.pending)
        .map(|entry| {
            (
                entry.message.id,
                entry.message.content,
                entry.message.edited_at,
            )
        })
        .collect()
}

async fn chat_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "chat", format, &[("dave", "readOnly")]).await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project.id, quick()).await;
    probed(&alice).await;
    probed(&dave).await;
    assert!(alice.session.chat_support().available);
    assert!(dave.session.chat_support().available);

    let mut sent = Vec::new();
    for line in [
        "First CE chat line",
        "Second CE chat line",
        "Third CE chat line",
    ] {
        let entry = alice.session.send_chat(line).await.unwrap();
        assert!(!entry.pending && !entry.message.id.starts_with("local-"));
        assert_eq!(entry.message.content, line);
        sent.push(entry.message.id);
    }
    let viewer = dave
        .session
        .send_chat("A viewer may chat too")
        .await
        .unwrap();
    assert!(!viewer.pending);
    sent.push(viewer.message.id.clone());
    let contents = |page: &[(String, String, Option<i64>)]| {
        page.iter()
            .map(|(_, content, _)| content.clone())
            .collect::<Vec<_>>()
    };
    let everything = vec![
        "First CE chat line",
        "Second CE chat line",
        "Third CE chat line",
        "A viewer may chat too",
    ];
    let (everything, contents) = (&everything, &contents);
    for live in [&alice, &dave] {
        eventually(
            "each session lists the four messages in order",
            move || async move {
                let page = live_chat(live, 10).await;
                (contents(&page) == *everything).then_some(())
            },
        )
        .await;
    }

    let reader = live(&ce, &alice_web, &project.id, quick()).await;
    probed(&reader).await;
    let newest = reader.session.chat_page(None, 2).await.unwrap();
    assert_eq!(
        newest
            .iter()
            .map(|entry| entry.message.content.as_str())
            .collect::<Vec<_>>(),
        everything[2..]
    );
    let older = reader
        .session
        .chat_page(Some(&newest[0].message.id), 2)
        .await
        .unwrap();
    assert_eq!(
        older
            .iter()
            .map(|entry| entry.message.content.as_str())
            .collect::<Vec<_>>(),
        everything[..2]
    );
    let oldest = reader
        .session
        .chat_page(Some(&older[0].message.id), 2)
        .await
        .unwrap();
    assert!(oldest.is_empty());
    reader.session.stop().await;

    let edited = alice
        .session
        .edit_chat(&sent[0], "First CE chat line, edited")
        .await
        .unwrap();
    assert_eq!(edited.message.content, "First CE chat line, edited");
    let (reading, first) = (&dave, &sent[0]);
    eventually("dave sees the edit", move || async move {
        live_chat(reading, 10)
            .await
            .into_iter()
            .find(|(id, content, at)| {
                id == first && content == "First CE chat line, edited" && at.is_some()
            })
    })
    .await;
    assert_eq!(
        dave.session.edit_chat(&sent[0], "Not mine").await,
        Err(ReviewWriteError::NotAllowed)
    );
    assert_eq!(
        dave.session.delete_chat(&sent[0]).await,
        Err(ReviewWriteError::NotAllowed)
    );
    assert_eq!(
        alice.session.delete_chat(&viewer.message.id).await,
        Err(ReviewWriteError::NotAllowed)
    );
    for id in &sent[..3] {
        alice.session.delete_chat(id).await.unwrap();
    }
    dave.session.delete_chat(&viewer.message.id).await.unwrap();
    for live in [&alice, &dave] {
        eventually("every message is gone", move || async move {
            live_chat(live, 10).await.is_empty().then_some(())
        })
        .await;
    }

    share_by_link(&mut alice_web, &project.id, true).await;
    let token = tokens(&mut alice_web, &project.id).await["readOnly"]
        .as_str()
        .unwrap()
        .to_string();
    let mut erin_web = Web::sign_in(&ce, "erin").await;
    join_by_link(&mut erin_web, &token).await;
    let erin = live(&ce, &erin_web, &project.id, quick()).await;
    assert_eq!(erin.watch.seen().flags.first(), Some(&(true, false)));
    probed(&erin).await;
    assert!(!erin.session.chat_support().available);
    assert_eq!(
        erin.session.send_chat("A link viewer").await,
        Err(ReviewWriteError::Restricted)
    );
    assert_eq!(
        erin.session.chat_page(None, 10).await,
        Err(ReviewWriteError::Restricted)
    );
    erin.session.stop().await;
    dave.session.stop().await;
    alice.session.stop().await;
}

on_both!(
    chat_gate,
    ce_chat_sends_edits_deletes_and_pages_on_sharejs,
    ce_chat_sends_edits_deletes_and_pages_on_history_ot
);

fn standing(live: &Live, email: &str) -> Option<(Standing, Option<Role>)> {
    live.session
        .people()
        .people
        .into_iter()
        .find(|person| person.email.eq_ignore_ascii_case(email))
        .map(|person| (person.standing, person.role))
}

async fn invite_token(ce: &Ce, web: &Web, project: &str) -> Option<String> {
    let http = Http::new(&ce.site, AGENT).unwrap();
    http.dashboard(&web.cookie())
        .await
        .unwrap()
        .invites
        .into_iter()
        .find(|invite| invite.project_id == project)
        .map(|invite| invite.token)
}

async fn accept(ce: &Ce, web: &Web, project: &str) {
    let token = eventually("the invite reaches the dashboard", move || async move {
        invite_token(ce, web, project).await
    })
    .await;
    let http = Http::new(&ce.site, AGENT).unwrap();
    let link = ProjectLink::Invite {
        project: project.to_owned(),
        token,
    };
    accept_invite(&http, &web.cookie(), &web.csrf, &link)
        .await
        .unwrap();
    accept_invite(&http, &web.cookie(), &web.csrf, &link)
        .await
        .expect("a used invite counts as accepted");
    assert!(invite_token(ce, web, project).await.is_none());
}

async fn people_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "people",
        format,
        &[("bob", "readAndWrite")],
    )
    .await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    probed(&alice).await;
    assert_eq!(
        standing(&alice, &ce.email("alice")),
        Some((Standing::Member, Some(Role::Owner)))
    );
    assert_eq!(
        standing(&alice, &ce.email("bob")),
        Some((Standing::Member, Some(Role::Editor)))
    );

    let stranger = "frank@example.test";
    let erin_email = ce.email("erin");
    invite(&mut alice_web, &project.id, &erin_email, "readOnly").await;
    let frank = invite(&mut alice_web, &project.id, stranger, "readAndWrite").await;
    until("alice lists both invitations", || {
        standing(&alice, &erin_email).is_some_and(|(standing, _)| standing == Standing::Invited)
            && standing(&alice, stranger).is_some_and(|(standing, _)| standing == Standing::Invited)
    })
    .await;

    let erin_web = Web::sign_in(&ce, "erin").await;
    accept(&ce, &erin_web, &project.id).await;
    until("erin is a viewer on alice's list", || {
        standing(&alice, &erin_email) == Some((Standing::Member, Some(Role::Viewer)))
    })
    .await;
    let erin = live(&ce, &erin_web, &project.id, quick()).await;
    assert_eq!(role(&erin), Some((Role::Viewer, false)));
    probed(&erin).await;
    erin.session.send_chat("Erin says hello").await.unwrap();
    let owner = &alice;
    eventually("alice hears erin", move || async move {
        live_chat(owner, 10)
            .await
            .into_iter()
            .find(|(_, content, _)| content == "Erin says hello")
    })
    .await;

    remove_member(&mut alice_web, &project.id, &ce.user_id("erin")).await;
    until("erin's session ends as removed", || {
        ended(&erin) == Some(LiveEnd::Removed)
    })
    .await;
    until("erin is a former member on alice's list", || {
        standing(&alice, &erin_email).is_some_and(|(standing, _)| standing == Standing::Former)
    })
    .await;
    revoke_invite(&mut alice_web, &project.id, &frank).await;
    until("the revoked invitation leaves the list", || {
        standing(&alice, stranger).is_none()
    })
    .await;
    erin.session.stop().await;
    alice.session.stop().await;
}

on_both!(
    people_gate,
    ce_people_follow_invites_accepts_and_removals_on_sharejs,
    ce_people_follow_invites_accepts_and_removals_on_history_ot
);

async fn invite_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "invite", format, &[]).await;
    invite(&mut alice_web, &project.id, &ce.email("carol"), "review").await;
    let carol_web = Web::sign_in(&ce, "carol").await;
    accept(&ce, &carol_web, &project.id).await;
    let carol = live(&ce, &carol_web, &project.id, quick()).await;
    assert_eq!(role(&carol), Some((Role::Reviewer, true)));
    let main = opened(&carol, MAIN).await;
    append(&carol, &main, "\nCarol joined by invitation.\n").await;
    let carol_id = ce.user_id("carol");
    until("carol's edit is a suggestion", || {
        tracked_changes(&ce, &project.id, &main)
            .iter()
            .any(|change| change["metadata"]["user_id"] == carol_id.as_str())
    })
    .await;
    carol.session.stop().await;
}

on_both!(
    invite_gate,
    ce_an_invite_from_the_dashboard_is_accepted_and_goes_live_on_sharejs,
    ce_an_invite_from_the_dashboard_is_accepted_and_goes_live_on_history_ot
);

async fn links_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "links", format, &[]).await;
    share_by_link(&mut alice_web, &project.id, true).await;
    let tokens = tokens(&mut alice_web, &project.id).await;
    let token = |key: &str| tokens[key].as_str().unwrap().to_string();
    let read = format!("{}/read/{}", ce.site, token("readOnly"));
    let edit = format!(
        "{}/{}#{}",
        ce.site,
        token("readAndWrite"),
        token("readAndWriteHashPrefix")
    );
    let http = Http::new(&ce.site, AGENT).unwrap();

    let (base, read_link) = parse_link(&read, &ce.site).unwrap();
    assert_eq!(base, ce.site);
    assert!(read_link.read_only());
    let mut erin_web = Web::sign_in(&ce, "erin").await;
    assert!(!can_read(&mut erin_web, &project.id).await);
    for _ in 0..2 {
        let preview = preview_token(&http, &erin_web.cookie(), &erin_web.csrf, &read_link)
            .await
            .unwrap();
        assert!(
            matches!(preview, TokenReply::RequireAccept { .. }),
            "{preview:?}"
        );
    }
    assert!(
        !can_read(&mut erin_web, &project.id).await,
        "a preview grants nothing"
    );
    assert_eq!(
        grant_token(&http, &erin_web.cookie(), &erin_web.csrf, &read_link)
            .await
            .unwrap(),
        TokenReply::Granted {
            project_id: project.id.clone(),
            read_only: true
        }
    );
    assert!(can_read(&mut erin_web, &project.id).await);
    let erin = live(&ce, &erin_web, &project.id, quick()).await;
    assert_eq!(role(&erin), Some((Role::Viewer, false)));
    assert_eq!(erin.watch.seen().flags.first(), Some(&(true, false)));

    let (_, edit_link) = parse_link(&edit, &ce.site).unwrap();
    assert!(matches!(edit_link, ProjectLink::Edit { .. }));
    let bob_web = Web::sign_in(&ce, "bob").await;
    let preview = preview_token(&http, &bob_web.cookie(), &bob_web.csrf, &edit_link)
        .await
        .unwrap();
    assert!(
        matches!(preview, TokenReply::RequireAccept { .. }),
        "{preview:?}"
    );
    assert_eq!(
        grant_token(&http, &bob_web.cookie(), &bob_web.csrf, &edit_link)
            .await
            .unwrap(),
        TokenReply::Granted {
            project_id: project.id.clone(),
            read_only: false
        }
    );
    let bob = live(&ce, &bob_web, &project.id, quick()).await;
    assert_eq!(role(&bob), Some((Role::Editor, false)));
    assert_eq!(
        grant_token(&http, &alice_web.cookie(), &alice_web.csrf, &read_link)
            .await
            .unwrap(),
        TokenReply::Already {
            project_id: project.id.clone()
        }
    );

    let main = opened(&bob, MAIN).await;
    opened(&erin, MAIN).await;
    append(&bob, &main, "\nBob joined by link.\n").await;
    until("the link viewer sees bob's edit", || {
        erin.session
            .text(&main)
            .is_some_and(|text| text.contains("Bob joined by link."))
    })
    .await;
    bob.session.stop().await;
    erin.session.stop().await;
}

on_both!(
    links_gate,
    ce_a_share_link_is_previewed_then_granted_on_sharejs,
    ce_a_share_link_is_previewed_then_granted_on_history_ot
);

async fn history_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "history", format, &[]).await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    let main = opened(&alice, MAIN).await;
    append(&alice, &main, "\nFirst history edit.\n").await;
    flush(&mut alice_web, &project.id).await;
    let extra = add_doc(
        &mut alice_web,
        &project.id,
        "extra.tex",
        &root_folder(&alice),
    )
    .await;
    until("the new doc reaches the session", || {
        alice.session.doc_at("extra.tex").as_ref() == Some(&extra)
    })
    .await;
    let opened_extra = opened(&alice, "extra.tex").await;
    assert_eq!(opened_extra, extra);
    append(&alice, &extra, "Extra file text.\n").await;
    flush(&mut alice_web, &project.id).await;
    let owner = &alice;
    let with_extra = eventually("the history lists extra.tex", move || async move {
        owner
            .session
            .history_page(None, 1)
            .await
            .ok()?
            .updates
            .into_iter()
            .find(|update| update.paths.iter().any(|path| path == "extra.tex"))
            .map(|update| update.to)
    })
    .await;
    delete_doc(&mut alice_web, &project.id, &extra).await;
    until("the session sees extra.tex go", || {
        alice.session.doc_at("extra.tex").is_none()
    })
    .await;
    append(&alice, &main, "Second history edit.\n").await;
    flush(&mut alice_web, &project.id).await;
    let alice_id = ce.user_id("alice");
    let page = eventually("the history has the second edit", move || async move {
        let page = owner.session.history_page(None, 1).await.ok()?;
        page.updates
            .first()
            .is_some_and(|newest| newest.to > with_extra)
            .then_some(page)
    })
    .await;
    let latest = page.updates[0].to;
    assert!(page.updates.windows(2).all(|pair| pair[0].to >= pair[1].to));
    assert!(page.updates.iter().all(|update| update.from <= update.to));
    assert!(page
        .updates
        .iter()
        .any(|update| update.users.iter().any(|user| user.id == alice_id)));
    let earlier = alice
        .session
        .history_page(Some(with_extra), 10)
        .await
        .unwrap();
    assert!(!earlier.updates.is_empty());
    assert!(earlier.updates.iter().all(|update| update.to <= with_extra));

    let named = alice
        .session
        .add_label(with_extra, "Oleafly CE label")
        .await
        .unwrap();
    assert_eq!(
        (named.version, named.comment.as_str()),
        (with_extra, "Oleafly CE label")
    );
    assert!(alice
        .session
        .history_labels()
        .await
        .unwrap()
        .iter()
        .any(|label| label.id == named.id));
    alice.session.delete_label(&named.id).await.unwrap();
    assert!(!alice
        .session
        .history_labels()
        .await
        .unwrap()
        .iter()
        .any(|label| label.id == named.id));

    let diff = alice
        .session
        .history_tree_diff(with_extra, latest)
        .await
        .unwrap();
    let entry = |path: &str| {
        diff.iter()
            .find(|entry| entry.path == path)
            .unwrap_or_else(|| panic!("{path} is not in {diff:?}"))
    };
    assert_eq!(entry("extra.tex").op, Some(TreeOp::Removed));
    assert!(entry("extra.tex").deleted_at.is_some());
    assert_eq!(entry(MAIN).op, Some(TreeOp::Edited));
    let DocAtVersion::Text(then) = alice
        .session
        .doc_at_version(with_extra, "extra.tex")
        .await
        .unwrap()
    else {
        panic!("extra.tex was a text file");
    };
    assert!(then.contains("Extra file text."));
    let DocAtVersion::Text(now) = alice.session.doc_at_version(latest, MAIN).await.unwrap() else {
        panic!("main.tex is a text file");
    };
    assert_eq!(now, alice.session.text(&main).unwrap());

    assert_eq!(
        alice.session.revert_file(with_extra, MAIN).await,
        Err(HistoryError::CannotRevert)
    );
    assert_eq!(
        alice.session.revert_project(with_extra).await,
        Err(HistoryError::CannotRevert)
    );
    let restored = alice
        .session
        .restore_file(with_extra, "extra.tex")
        .await
        .unwrap();
    assert_eq!(restored.kind, NodeKind::Doc);
    until("the restored doc reaches the session", || {
        alice.session.doc_at("extra.tex").map(|doc| doc.0) == Some(restored.id.0.clone())
    })
    .await;
    let back = opened(&alice, "extra.tex").await;
    assert!(alice
        .session
        .text(&back)
        .unwrap()
        .contains("Extra file text."));

    let folder = tempfile::tempdir().unwrap();
    let zip_path = folder.path().join("version.zip");
    let mut progress = Vec::new();
    let bytes = alice
        .session
        .version_zip(with_extra, &zip_path, |done, _| progress.push(done))
        .await
        .unwrap();
    assert!(bytes > 0);
    assert_eq!(progress.last().copied(), Some(bytes));
    let zipped = std::fs::read(&zip_path).unwrap();
    assert!(zipped.starts_with(b"PK"));
    let archive = zip::ZipArchive::new(std::fs::File::open(&zip_path).unwrap()).unwrap();
    let names: Vec<String> = archive
        .file_names()
        .map(|name| name.unwrap().into_owned())
        .collect();
    assert!(
        names.iter().any(|name| name == MAIN) && names.iter().any(|name| name == "extra.tex"),
        "{names:?}"
    );
    alice.session.stop().await;
}

on_both!(
    history_gate,
    ce_history_pages_labels_compares_restores_and_zips_on_sharejs,
    ce_history_pages_labels_compares_restores_and_zips_on_history_ot
);

async fn heard_by_all(sessions: &[&Live], event: &ProjectEvent) {
    until("every session hears the setting", || {
        sessions.iter().all(|live| heard(live, event))
    })
    .await;
}

async fn settings_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "settings",
        format,
        &[("bob", "readAndWrite"), ("carol", "review")],
    )
    .await;
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    let bob = live(&ce, &Web::sign_in(&ce, "bob").await, &project.id, quick()).await;
    let carol = live(&ce, &Web::sign_in(&ce, "carol").await, &project.id, quick()).await;
    let other = add_doc(
        &mut alice_web,
        &project.id,
        "other.tex",
        &root_folder(&alice),
    )
    .await;
    until("the new doc reaches both sessions", || {
        [&alice, &bob]
            .iter()
            .all(|live| live.session.doc_at("other.tex").as_ref() == Some(&other))
    })
    .await;
    let bib = alice.session.doc_at(BIB).unwrap();
    let main = alice.session.doc_at(MAIN).unwrap();

    let steps = [
        (
            SettingsUpdate {
                compiler: Some("xelatex".into()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::Compiler("xelatex".into()),
        ),
        (
            SettingsUpdate {
                spelling: Some("de".into()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::SpellLanguage("de".into()),
        ),
        (
            SettingsUpdate {
                root_doc: Some(other.clone()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::RootDoc(other.clone()),
        ),
        (
            SettingsUpdate {
                bibliography: Some(bib.clone()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::MainBibliography(bib.clone()),
        ),
        (
            SettingsUpdate {
                image: Some("texlive-full:2025.1".into()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::Image("texlive-full:2025.1".into()),
        ),
        (
            SettingsUpdate {
                root_doc: Some(main.clone()),
                ..SettingsUpdate::default()
            },
            ProjectEvent::RootDoc(main.clone()),
        ),
    ];
    for (update, event) in steps {
        alice.session.update_settings(&update).await.unwrap();
        heard_by_all(&[&alice, &bob, &carol], &event).await;
    }
    for live in [&alice, &bob, &carol] {
        let settings = live.session.project_settings();
        assert_eq!(settings.compiler.as_deref(), Some("xelatex"));
        assert_eq!(settings.spelling.as_deref(), Some("de"));
        assert_eq!(settings.root_doc.as_ref(), Some(&main));
        assert_eq!(settings.bibliography.as_ref(), Some(&bib));
        assert_eq!(settings.image.as_deref(), Some("texlive-full:2025.1"));
        assert!(!settings.languages.is_empty());
    }

    settings(
        &mut alice_web,
        &project.id,
        json!({ "compiler": "LuaLaTeX" }),
    )
    .await;
    until("a change on the web reaches every session", || {
        [&alice, &bob, &carol]
            .iter()
            .all(|live| live.session.project_settings().compiler.as_deref() == Some("lualatex"))
    })
    .await;
    settings(&mut alice_web, &project.id, json!({ "compiler": "" })).await;
    settings(
        &mut alice_web,
        &project.id,
        json!({ "spellCheckLanguage": "fr" }),
    )
    .await;
    heard_by_all(
        &[&alice, &bob, &carol],
        &ProjectEvent::SpellLanguage("fr".into()),
    )
    .await;
    for live in [&alice, &bob, &carol] {
        assert_eq!(
            live.session.project_settings().compiler.as_deref(),
            Some("lualatex"),
            "an empty compiler is not stored"
        );
        assert!(!heard(live, &ProjectEvent::Compiler(String::new())));
    }
    bob.session
        .update_settings(&SettingsUpdate {
            compiler: Some("pdflatex".into()),
            ..SettingsUpdate::default()
        })
        .await
        .unwrap();
    until("an editor's change reaches the owner", || {
        alice.session.project_settings().compiler.as_deref() == Some("pdflatex")
    })
    .await;
    let refused = carol
        .session
        .update_settings(&SettingsUpdate {
            compiler: Some("latex".into()),
            ..SettingsUpdate::default()
        })
        .await;
    assert_eq!(refused, Err(RestError::NotAllowed));
    let unknown = alice
        .session
        .update_settings(&SettingsUpdate {
            compiler: Some("luatex".into()),
            ..SettingsUpdate::default()
        })
        .await;
    assert!(matches!(
        unknown,
        Err(RestError::Refused { status: 400, .. })
    ));
    alice
        .session
        .update_settings(&SettingsUpdate {
            spelling: Some("es".into()),
            ..SettingsUpdate::default()
        })
        .await
        .unwrap();
    heard_by_all(
        &[&alice, &bob, &carol],
        &ProjectEvent::SpellLanguage("es".into()),
    )
    .await;
    for live in [&alice, &bob, &carol] {
        let settings = live.session.project_settings();
        assert_eq!(settings.compiler.as_deref(), Some("pdflatex"));
        assert_eq!(settings.spelling.as_deref(), Some("es"));
        for refused in ["latex", "luatex"] {
            assert!(!heard(live, &ProjectEvent::Compiler(refused.into())));
        }
    }
    carol.session.stop().await;
    bob.session.stop().await;
    alice.session.stop().await;
}

on_both!(
    settings_gate,
    ce_settings_follow_every_key_three_ways_on_sharejs,
    ce_settings_follow_every_key_three_ways_on_history_ot
);

async fn linked_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let source = scratch(&ce, &mut alice_web, "linked-source", format, &[]).await;
    let target = scratch(
        &ce,
        &mut alice_web,
        "linked-target",
        format,
        &[("bob", "readAndWrite"), ("dave", "readOnly")],
    )
    .await;
    let alice = live(&ce, &alice_web, &target.id, quick()).await;
    let linked = link_file(
        &mut alice_web,
        &target.id,
        "linked.bib",
        &root_folder(&alice),
        &source.id,
        "/sample.bib",
    )
    .await;
    until(
        "the linked file reaches the session with its source",
        || {
            node(&alice, "linked.bib").is_some_and(|file| {
                file.id == linked
                    && file.kind == NodeKind::File
                    && file.linked.as_ref().is_some_and(|from| {
                        from.provider == "project_file"
                            && from.source_project.as_deref() == Some(source.id.as_str())
                            && from.source_path.as_deref() == Some("/sample.bib")
                    })
            })
        },
    )
    .await;
    let first = alice
        .session
        .download(&linked, &mut |_, _| {})
        .await
        .unwrap();

    let writer = live(&ce, &alice_web, &source.id, quick()).await;
    let bib = opened(&writer, BIB).await;
    assert_eq!(writer.session.text(&bib).unwrap().as_bytes(), first);
    append(&writer, &bib, "% changed in the source project\n").await;
    writer.session.stop().await;

    let frog = node(&alice, "frog.jpg").unwrap();
    assert_eq!(
        alice.session.refresh_linked(&frog.id).await,
        Err(LinkedError::NotLinked)
    );
    let refreshed = alice.session.refresh_linked(&linked).await.unwrap();
    assert_ne!(refreshed, linked);
    until("the refreshed file replaces the old one", || {
        node(&alice, "linked.bib").is_some_and(|file| file.id == refreshed && file.linked.is_some())
    })
    .await;
    let second = alice
        .session
        .download(&refreshed, &mut |_, _| {})
        .await
        .unwrap();
    assert!(String::from_utf8(second)
        .unwrap()
        .contains("% changed in the source project"));

    let bob = live(&ce, &Web::sign_in(&ce, "bob").await, &target.id, quick()).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &target.id, quick()).await;
    for live in [&bob, &dave] {
        until("the refreshed file reaches the others", || {
            node(live, "linked.bib").is_some_and(|file| file.id == refreshed)
        })
        .await;
    }
    let outsider = bob.session.refresh_linked(&refreshed).await;
    assert!(
        matches!(&outsider, Err(LinkedError::Refused { status: 403, message }) if message.contains("not shared")),
        "{outsider:?}"
    );
    assert_eq!(
        dave.session.refresh_linked(&refreshed).await,
        Err(LinkedError::NotAllowed)
    );
    dave.session.stop().await;
    bob.session.stop().await;
    alice.session.stop().await;
}

on_both!(
    linked_gate,
    ce_a_linked_file_is_refreshed_from_its_source_on_sharejs,
    ce_a_linked_file_is_refreshed_from_its_source_on_history_ot
);

async fn learned(ce: &Ce, web: &Web, project: &str) -> Vec<String> {
    let reader = live(ce, web, project, quick()).await;
    let words = reader
        .session
        .learned_words()
        .expect("the editor page lists the learned words");
    reader.session.stop().await;
    words
}

async fn words_gate(format: DocFormat) {
    let ce = Ce::load();
    let project = seeded_project(&ce, seeded(format));
    let bob_web = Web::sign_in(&ce, "bob").await;
    let word = format!("Oleaflycegate{}", label(format).replace('-', ""));
    let only = std::slice::from_ref(&word);
    let bob = live(&ce, &bob_web, &project, quick()).await;
    if bob.session.learned_words().unwrap().contains(&word) {
        bob.session.spell(&[], only).await;
    }
    let spelled = bob.session.spell(only, &[]).await;
    assert_eq!(spelled.learned, only);
    assert!(spelled.stopped.is_none(), "{spelled:?}");
    bob.session.stop().await;
    assert!(learned(&ce, &bob_web, &project).await.contains(&word));
    let again = live(&ce, &bob_web, &project, quick()).await;
    let spelled = again.session.spell(&[], only).await;
    assert_eq!(spelled.unlearned, only);
    assert!(spelled.stopped.is_none(), "{spelled:?}");
    again.session.stop().await;
    assert!(!learned(&ce, &bob_web, &project).await.contains(&word));
}

on_both!(
    words_gate,
    ce_learned_words_are_learned_and_unlearned_on_sharejs,
    ce_learned_words_are_learned_and_unlearned_on_history_ot
);

async fn fill_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = scratch(&ce, &mut alice_web, "fill", format, &[]).await;
    let preparer = live(&ce, &alice_web, &project.id, quick()).await;
    let root = root_folder(&preparer);
    let mut paths = vec![MAIN.to_string(), BIB.to_string()];
    for name in ["one.tex", "two.tex", "three.tex"] {
        let doc = add_doc(&mut alice_web, &project.id, name, &root).await;
        until("the new doc reaches the session", || {
            preparer.session.doc_at(name).as_ref() == Some(&doc)
        })
        .await;
        let doc = opened(&preparer, name).await;
        append(&preparer, &doc, &format!("Text of {name}.\n")).await;
        paths.push(name.to_string());
    }
    preparer.session.stop().await;

    let http = Http::new(&ce.site, AGENT).unwrap();
    let handle = handle_of(&ce, &http, &alice_web).await;
    let filler = start(&ce, http, handle, &project.id, quick(), true).await;
    until("every doc is in", || {
        filler.watch.seen().filling.last() == Some(&(paths.len(), paths.len()))
    })
    .await;
    let filling = filler.watch.seen().filling.clone();
    assert!(
        filling.windows(2).all(|pair| pair[0].0 <= pair[1].0),
        "{filling:?}"
    );
    for path in &paths {
        let doc = filler.session.doc_at(path).unwrap();
        let text = filler
            .session
            .text(&doc)
            .unwrap_or_else(|| panic!("{path} was filled"));
        assert_eq!(text, ce.server_text(&project.id, &doc), "{path}");
    }
    filler.session.stop().await;
}

on_both!(
    fill_gate,
    ce_opening_live_without_an_import_fills_every_doc_on_sharejs,
    ce_opening_live_without_an_import_fills_every_doc_on_history_ot
);

fn local_project(root: &Path, title: &str) -> BTreeMap<String, PathBuf> {
    let files = [
        (
            "main.tex",
            format!(
                "\\documentclass{{article}}\n\\title{{{title}}}\n\\begin{{document}}\n\\input{{sections/intro}}\nCreated from a local folder.\n\\end{{document}}\n"
            ),
        ),
        ("sections/intro.tex", "An introduction.\n".to_string()),
        ("refs.bib", "@misc{oleafly, title = {Oleafly}}\n".to_string()),
    ];
    files
        .into_iter()
        .map(|(path, text)| {
            let at = root.join(path);
            std::fs::create_dir_all(at.parent().unwrap()).unwrap();
            std::fs::write(&at, text).unwrap();
            (path.to_string(), at)
        })
        .collect()
}

async fn create_gate(format: DocFormat) {
    let ce = Ce::load();
    let alice_web = Web::sign_in(&ce, "alice").await;
    let folder = tempfile::tempdir().unwrap();
    let title = format!("oleafly-ce-created-{}-{}", label(format), now_ms());
    let files = local_project(&folder.path().join("project"), &title);
    let zip_path = folder.path().join("upload.zip");
    let texts = archive::zip_files(&files, &zip_path).unwrap();
    let http = Http::new(&ce.site, AGENT).unwrap();
    let created = create_project(
        &http,
        &alice_web.cookie(),
        &alice_web.csrf,
        &title,
        std::fs::read(&zip_path).unwrap(),
    )
    .await
    .unwrap();
    let project = Scratch {
        ce: &ce,
        id: created,
    };
    if format == DocFormat::HistoryOt {
        ce.to_history_ot(&project.id);
    }
    let alice = live(&ce, &alice_web, &project.id, quick()).await;
    for (path, text) in &texts {
        let doc = opened(&alice, path).await;
        assert_eq!(&alice.session.text(&doc).unwrap(), text, "{path}");
    }
    let main = alice.session.doc_at(MAIN).unwrap();
    assert_eq!(alice.session.review(&main).unwrap().format, format);
    assert_eq!(
        alice.session.project_settings().root_doc.as_ref(),
        Some(&main)
    );
    append(&alice, &main, "% edited live after the upload\n").await;
    assert!(ce
        .server_text(&project.id, &main)
        .contains("% edited live after the upload"));
    alice.session.stop().await;
}

on_both!(
    create_gate,
    ce_a_local_project_is_created_on_the_server_then_goes_live_on_sharejs,
    ce_a_local_project_is_created_on_the_server_then_goes_live_on_history_ot
);

async fn accounts_gate(format: DocFormat) {
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let bob_web = Web::sign_in(&ce, "bob").await;
    let project = scratch(
        &ce,
        &mut alice_web,
        "accounts",
        format,
        &[("bob", "readAndWrite")],
    )
    .await;
    let http = Http::new(&ce.site, AGENT).unwrap();
    let store_dir = tempfile::tempdir().unwrap();
    let store = SecretStore::at(store_dir.path());
    let (alice_id, bob_id) = (ce.user_id("alice"), ce.user_id("bob"));
    for web in [&alice_web, &bob_web] {
        let signed = session_of(&http, web).await;
        session::save(&store, &ce.site, &signed).unwrap();
    }
    let listed: Vec<String> = session::accounts(&store, &ce.site)
        .unwrap()
        .into_iter()
        .map(|account| account.user_id)
        .collect();
    assert_eq!(listed, [bob_id.clone(), alice_id.clone()]);
    assert!(session::use_account(&store, &ce.site, &alice_id).unwrap());
    assert_eq!(
        session::load(&store, &ce.site).unwrap().unwrap().user_id,
        alice_id
    );

    let mut sessions = Vec::new();
    for user in [&alice_id, &bob_id] {
        let stored = session::load_account(&store, &ce.site, user)
            .unwrap()
            .unwrap();
        let handle = SessionHandle::new(&ce.site, stored, Some(store.clone()));
        let live = start(
            &ce,
            Http::new(&ce.site, AGENT).unwrap(),
            handle,
            &project.id,
            quick(),
            false,
        )
        .await;
        assert_eq!(&live.session.account().user_id, user);
        sessions.push(live);
    }
    let (alice, bob) = (&sessions[0], &sessions[1]);
    assert_eq!(role(alice), Some((Role::Owner, false)));
    assert_eq!(role(bob), Some((Role::Editor, false)));
    let main = opened(alice, MAIN).await;
    opened(bob, MAIN).await;
    append(alice, &main, "\nFrom the first account.\n").await;
    until("the second account sees the first", || {
        bob.session
            .text(&main)
            .is_some_and(|text| text.contains("From the first account."))
    })
    .await;
    append(bob, &main, "From the second account.\n").await;
    until("the first account sees the second", || {
        alice
            .session
            .text(&main)
            .is_some_and(|text| text.contains("From the second account."))
    })
    .await;

    for (user, owned) in [(&alice_id, true), (&bob_id, false)] {
        let listing = projects::list_account(&http, &store, Some(user.as_str()))
            .await
            .unwrap();
        assert_eq!(&listing.session.user_id, user);
        assert!(listing
            .projects
            .iter()
            .any(|listed| listed.id == project.id && listed.owned == owned));
    }
    assert!(session::forget_account(&store, &ce.site, &bob_id).unwrap());
    assert!(session::load_account(&store, &ce.site, &bob_id)
        .unwrap()
        .is_none());
    assert_eq!(
        session::load(&store, &ce.site).unwrap().unwrap().user_id,
        alice_id
    );
    for live in &sessions {
        live.session.stop().await;
    }
}

on_both!(
    accounts_gate,
    ce_two_accounts_on_one_server_each_run_as_themselves_on_sharejs,
    ce_two_accounts_on_one_server_each_run_as_themselves_on_history_ot
);
