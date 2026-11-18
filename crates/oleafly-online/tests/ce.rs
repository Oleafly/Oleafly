use std::collections::BTreeMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant};

use oleafly_online::client::Http;
use oleafly_online::live::journal::Journal;
use oleafly_online::live::session::{
    DocStopReason, LiveEnd, LivePeer, LivePort, LiveState, MergeReview, OverleafSession,
    SessionConfig, SessionTuning,
};
use oleafly_online::realtime::connection::Carrier;
use oleafly_online::realtime::events::{DocId, ProjectEvent, PublicId};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::PathChange;
use oleafly_online::session::{self, SessionHandle};
use oleafly_ot::testing::{deletion, insertion};
use oleafly_ot::utf16_len;
use serde_json::{json, Value};
use tokio::sync::Mutex as TurnLock;

const AGENT: &str = "Oleafly/ce-e2e";
const WAIT: Duration = Duration::from_secs(30);
const SHARED: &str = "sharejs-project";
const MAIN: &str = "main.tex";

static TURN: TurnLock<()> = TurnLock::const_new(());

struct Ce {
    dir: PathBuf,
    site: String,
    state: Value,
    env: BTreeMap<String, String>,
}

impl Ce {
    fn load() -> Ce {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/overleaf-ce");
        let state: Value = serde_json::from_slice(
            &std::fs::read(dir.join("seed-state.json"))
                .expect("seed-state.json: run tools/overleaf-ce/up.sh first"),
        )
        .unwrap();
        let env = std::fs::read_to_string(dir.join(".env.local"))
            .unwrap()
            .lines()
            .filter_map(|line| line.split_once('='))
            .map(|(key, value)| (key.to_string(), value.to_string()))
            .collect();
        let site = state["site"]
            .as_str()
            .unwrap()
            .trim_end_matches('/')
            .to_string();
        Ce {
            dir,
            site,
            state,
            env,
        }
    }

    fn user_id(&self, who: &str) -> String {
        self.state["users"][who]["id"].as_str().unwrap().to_string()
    }

    fn email(&self, who: &str) -> String {
        self.state["users"][who]["email"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn password(&self, who: &str) -> String {
        self.env[&format!("{}_PASSWORD", who.to_uppercase())].clone()
    }

    fn project(&self, name: &str) -> String {
        self.state["projects"][name]["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn doc(&self, project: &str, path: &str) -> DocId {
        DocId(
            self.state["projects"][project]["docs"][path]
                .as_str()
                .unwrap()
                .to_string(),
        )
    }

    fn reseed(&self) {
        let status = std::process::Command::new(self.dir.join("up.sh"))
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "the seed did not run");
    }

    fn tracked_changes(&self, project: &str, doc: &DocId) -> Vec<Value> {
        let url = format!("http://127.0.0.1:3003/project/{project}/doc/{}", doc.0);
        let output = std::process::Command::new("docker")
            .args(["exec", "oleafly-overleaf-ce-overleaf-1", "curl", "-s", &url])
            .output()
            .unwrap();
        assert!(output.status.success(), "document-updater did not answer");
        let doc: Value = serde_json::from_slice(&output.stdout).unwrap();
        doc["ranges"]["changes"]
            .as_array()
            .cloned()
            .unwrap_or_default()
    }
}

struct Web {
    site: String,
    client: reqwest::Client,
    cookies: BTreeMap<String, String>,
    csrf: String,
}

fn csrf_in(html: &str) -> Option<String> {
    let start = html.find("name=\"ol-csrfToken\" content=\"")? + 29;
    let end = html[start..].find('"')? + start;
    Some(html[start..end].to_string())
}

impl Web {
    async fn sign_in(ce: &Ce, who: &str) -> Web {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let mut web = Web {
            site: ce.site.clone(),
            client,
            cookies: BTreeMap::new(),
            csrf: String::new(),
        };
        let page = web.page("/login").await;
        web.csrf = csrf_in(&page).expect("a CSRF token on the login page");
        let body =
            json!({ "email": ce.email(who), "password": ce.password(who), "_csrf": web.csrf });
        let (status, _) = web.call(reqwest::Method::POST, "/login", Some(body)).await;
        assert_eq!(status, 200, "{who} could not sign in");
        let page = web.page(&format!("/project/{}", ce.project(SHARED))).await;
        web.csrf = csrf_in(&page).expect("a CSRF token on the project page");
        web
    }

    fn cookie(&self) -> String {
        self.cookies
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ")
    }

    fn keep(&mut self, response: &reqwest::Response) {
        for header in response.headers().get_all(reqwest::header::SET_COOKIE) {
            let pair = header
                .to_str()
                .unwrap_or_default()
                .split(';')
                .next()
                .unwrap_or_default();
            if let Some((name, value)) = pair.split_once('=') {
                self.cookies
                    .insert(name.trim().to_string(), value.trim().to_string());
            }
        }
    }

    async fn page(&mut self, path: &str) -> String {
        let response = self
            .client
            .get(format!("{}{path}", self.site))
            .header("accept", "text/html")
            .header("cookie", self.cookie())
            .send()
            .await
            .unwrap();
        self.keep(&response);
        response.text().await.unwrap()
    }

    async fn call(
        &mut self,
        method: reqwest::Method,
        path: &str,
        body: Option<Value>,
    ) -> (u16, Value) {
        let mut request = self
            .client
            .request(method, format!("{}{path}", self.site))
            .header("accept", "application/json")
            .header("cookie", self.cookie())
            .header("x-csrf-token", self.csrf.clone());
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        self.keep(&response);
        let status = response.status().as_u16();
        let text = response.text().await.unwrap_or_default();
        (status, serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    async fn set_privilege(&mut self, project: &str, user: &str, level: &str) {
        let path = format!("/project/{project}/users/{user}");
        let (status, _) = self
            .call(
                reqwest::Method::PUT,
                &path,
                Some(json!({ "privilegeLevel": level })),
            )
            .await;
        assert_eq!(status, 204, "changing the role to {level}");
    }

    async fn new_project(&mut self, name: &str, template: &str) -> String {
        let body = json!({ "projectName": name, "template": template });
        let (status, reply) = self
            .call(reqwest::Method::POST, "/project/new", Some(body))
            .await;
        assert_eq!(status, 200, "creating {name}");
        reply["project_id"].as_str().unwrap().to_string()
    }

    async fn share_by_link(&mut self, project: &str, on: bool) {
        let level = if on { "tokenBased" } else { "private" };
        let path = format!("/project/{project}/settings/admin");
        let (status, _) = self
            .call(
                reqwest::Method::POST,
                &path,
                Some(json!({ "publicAccessLevel": level })),
            )
            .await;
        assert_eq!(status, 204, "link sharing {level}");
    }

    async fn read_only_token(&mut self, project: &str) -> String {
        let (status, tokens) = self
            .call(
                reqwest::Method::GET,
                &format!("/project/{project}/tokens"),
                None,
            )
            .await;
        assert_eq!(status, 200);
        tokens["readOnly"].as_str().unwrap().to_string()
    }

    async fn join_by_link(&mut self, token: &str) {
        let path = format!("/read/{token}/grant");
        let (status, reply) = self
            .call(
                reqwest::Method::POST,
                &path,
                Some(json!({ "confirmedByUser": true })),
            )
            .await;
        assert_eq!(status, 200, "{reply}");
    }

    async fn delete_project(&mut self, project: &str) {
        let (status, _) = self
            .call(
                reqwest::Method::DELETE,
                &format!("/project/{project}"),
                None,
            )
            .await;
        assert_eq!(status, 200, "deleting {project}");
    }
}

#[derive(Default)]
struct Seen {
    states: Vec<LiveState>,
    roles: Vec<(Role, bool)>,
    peers: Vec<LivePeer>,
    left: Vec<PublicId>,
    flags: Vec<(bool, bool)>,
    merged: Vec<(DocId, MergeReview)>,
    texts: Vec<DocId>,
}

#[derive(Default)]
struct Watch {
    seen: Mutex<Seen>,
}

impl Watch {
    fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn ended(&self) -> Option<LiveEnd> {
        self.seen()
            .states
            .iter()
            .rev()
            .find_map(|state| match state {
                LiveState::Ended(end) => Some(end.clone()),
                _ => None,
            })
    }

    fn online(&self) -> bool {
        matches!(self.seen().states.last(), Some(LiveState::Online { .. }))
    }

    fn role(&self) -> Option<(Role, bool)> {
        self.seen().roles.last().cloned()
    }

    fn sightings(&self, user: &str) -> Vec<LivePeer> {
        self.seen()
            .peers
            .iter()
            .filter(|peer| peer.user_id.as_deref() == Some(user))
            .cloned()
            .collect()
    }
}

impl LivePort for Watch {
    fn state(&self, state: LiveState) {
        self.seen().states.push(state);
    }

    fn role(&self, role: Role, tracking: bool) {
        self.seen().roles.push((role, tracking));
    }

    fn texts_changed(&self, docs: Vec<DocId>) {
        self.seen().texts.extend(docs);
    }

    fn tree_changed(&self, _changes: Vec<PathChange>) {}

    fn peer(&self, peer: LivePeer) {
        self.seen().peers.push(peer);
    }

    fn peer_left(&self, id: &PublicId) {
        self.seen().left.push(id.clone());
    }

    fn doc_stopped(&self, _doc: &DocId, _reason: DocStopReason) {}

    fn project_event(&self, _event: ProjectEvent) {}

    fn merged(&self, doc: &DocId, review: MergeReview) {
        self.seen().merged.push((doc.clone(), review));
    }

    fn journal_failed(&self, _reason: Option<String>) {}

    fn disk_text(&self, _path: &str) -> Option<String> {
        None
    }

    fn project_flags(&self, restricted: bool, deleted_externally: bool) {
        self.seen().flags.push((restricted, deleted_externally));
    }
}

struct Live {
    session: Arc<OverleafSession>,
    watch: Arc<Watch>,
    _data: tempfile::TempDir,
}

async fn live(ce: &Ce, web: &Web, project: &str, tuning: SessionTuning) -> Live {
    let http = Http::new(&ce.site, AGENT).unwrap();
    let signed = session::session_from_cookie(&http, web.cookie(), "ce-e2e")
        .await
        .unwrap();
    let handle = SessionHandle::new(&ce.site, signed, None);
    let data = tempfile::tempdir().unwrap();
    let journal = Journal::open(data.path(), &ce.site, project, None).unwrap();
    let watch = Arc::new(Watch::default());
    let config = SessionConfig {
        http,
        session: handle,
        project_id: project.to_string(),
        carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
        tuning,
        seeds: Vec::new(),
    };
    let session = OverleafSession::start(config, Arc::clone(&watch) as Arc<dyn LivePort>, journal)
        .await
        .unwrap();
    let live = Live {
        session,
        watch,
        _data: data,
    };
    until("the session is online", || live.watch.online()).await;
    live
}

fn quick() -> SessionTuning {
    SessionTuning {
        peer_reemit: Duration::from_millis(500),
        presence_with_peers: Duration::from_millis(100),
        ..SessionTuning::default()
    }
}

async fn until(what: &str, mut check: impl FnMut() -> bool) {
    let started = Instant::now();
    while !check() {
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn open(live: &Live, path: &str) -> DocId {
    let opened = live
        .session
        .open(path, Arc::new(|_| {}))
        .expect("a live doc");
    DocId(opened.file_id)
}

async fn seeded_roles(ce: &Ce, owner: &mut Web) {
    let project = ce.project(SHARED);
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
            ce.reseed();
            return;
        }
    }
}

async fn joined(live: &Live, doc: &DocId) {
    until("the doc is joined", || {
        live.watch.seen().texts.contains(doc) && live.session.text(doc).is_some()
    })
    .await;
}

async fn append(live: &Live, doc: &DocId, text: &str) {
    let added = live
        .session
        .local_edit_with(doc, |current| {
            let end = utf16_len(current);
            Some(insertion(end, end, text))
        })
        .unwrap();
    assert!(added);
    assert!(live.session.settle(WAIT).await, "the edit was confirmed");
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

#[tokio::test(flavor = "multi_thread")]
async fn ce_presence_reaches_coauthors_and_stays_while_they_read() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = ce.project(SHARED);
    let (alice_web, bob_web) = (
        Web::sign_in(&ce, "alice").await,
        Web::sign_in(&ce, "bob").await,
    );
    let alice = live(&ce, &alice_web, &project, quick()).await;
    let bob = live(&ce, &bob_web, &project, quick()).await;
    let main = ce.doc(SHARED, MAIN);
    assert_eq!(open(&alice, MAIN), main);
    open(&bob, MAIN);
    joined(&alice, &main).await;
    joined(&bob, &main).await;
    let alice_id = ce.user_id("alice");

    alice.session.presence(Some((main.clone(), 3)));
    until("bob sees alice's caret", || {
        bob.watch.sightings(&alice_id).iter().any(|peer| {
            peer.doc.as_ref() == Some(&main)
                && peer.offset == Some(3)
                && peer.name.as_deref() == Some("Alice Owner")
        })
    })
    .await;
    let before = bob.watch.sightings(&alice_id).len();
    until("alice stays visible while she only reads", || {
        bob.watch.sightings(&alice_id).len() >= before + 3
    })
    .await;
    assert!(bob
        .watch
        .sightings(&alice_id)
        .iter()
        .skip(before)
        .all(|peer| peer.offset == Some(3)));

    alice.session.presence(Some((main.clone(), 7)));
    until("bob sees alice move", || {
        bob.watch
            .sightings(&alice_id)
            .last()
            .is_some_and(|peer| peer.offset == Some(7))
    })
    .await;
    assert!(
        alice.watch.sightings(&alice_id).is_empty(),
        "alice saw her own echo"
    );

    let carol_web = Web::sign_in(&ce, "carol").await;
    let carol = live(&ce, &carol_web, &project, quick()).await;
    until(
        "carol, joining later, already lists alice where she is",
        || {
            carol
                .watch
                .sightings(&alice_id)
                .iter()
                .any(|peer| peer.doc.as_ref() == Some(&main))
        },
    )
    .await;

    let alice_public = bob.watch.sightings(&alice_id).last().unwrap().id.clone();
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
    let project = ce.project(SHARED);
    let web = Web::sign_in(&ce, "alice").await;
    let first = live(&ce, &web, &project, quick()).await;
    let second = live(&ce, &web, &project, quick()).await;
    let main = ce.doc(SHARED, MAIN);
    open(&first, MAIN);
    open(&second, MAIN);
    joined(&first, &main).await;
    joined(&second, &main).await;
    first.session.presence(Some((main.clone(), 2)));
    let alice_id = ce.user_id("alice");
    until("the other window shows as a peer with alice's id", || {
        second
            .watch
            .sightings(&alice_id)
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
    let project = ce.project(SHARED);
    seeded_roles(&ce, &mut Web::sign_in(&ce, "alice").await).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    assert_eq!(dave.watch.role(), Some((Role::Viewer, false)));
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
    let project = ce.project(SHARED);
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    seeded_roles(&ce, &mut alice_web).await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    assert_eq!(dave.watch.role(), Some((Role::Viewer, false)));
    let dave_id = ce.user_id("dave");
    alice_web
        .set_privilege(&project, &dave_id, "readAndWrite")
        .await;
    until("dave can edit", || {
        dave.watch
            .role()
            .is_some_and(|(role, _)| role == Role::Editor)
    })
    .await;
    let main = open(&dave, MAIN);
    joined(&dave, &main).await;
    append(&dave, &main, " (dave was here)").await;
    remove_suffix(&dave, &main, " (dave was here)").await;
    alice_web
        .set_privilege(&project, &dave_id, "readOnly")
        .await;
    until("dave is a viewer again", || {
        dave.watch.role() == Some((Role::Viewer, false))
    })
    .await;
    assert!(dave.watch.ended().is_none());
    dave.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_a_reviewer_edits_as_a_suggestion() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = ce.project(SHARED);
    seeded_roles(&ce, &mut Web::sign_in(&ce, "alice").await).await;
    let carol = live(&ce, &Web::sign_in(&ce, "carol").await, &project, quick()).await;
    assert_eq!(carol.watch.role(), Some((Role::Reviewer, true)));
    let main = open(&carol, MAIN);
    joined(&carol, &main).await;
    append(&carol, &main, " (suggested)").await;
    let carol_id = ce.user_id("carol");
    let changes = ce.tracked_changes(&project, &main);
    assert!(
        changes
            .iter()
            .any(|change| change["op"]["i"] == " (suggested)"
                && change["metadata"]["user_id"] == carol_id.as_str()),
        "the edit is a suggestion by carol: {changes:?}"
    );
    let alice = live(&ce, &Web::sign_in(&ce, "alice").await, &project, quick()).await;
    let seen = open(&alice, MAIN);
    joined(&alice, &seen).await;
    assert!(alice.session.text(&seen).unwrap().ends_with(" (suggested)"));
    remove_suffix(&alice, &seen, " (suggested)").await;
    assert!(carol.watch.ended().is_none());
    carol.session.stop().await;
    alice.session.stop().await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_removal_ends_live_as_removed() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let project = ce.project(SHARED);
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let dave = live(&ce, &Web::sign_in(&ce, "dave").await, &project, quick()).await;
    let path = format!("/project/{project}/users/{}", ce.user_id("dave"));
    let (status, _) = alice_web.call(reqwest::Method::DELETE, &path, None).await;
    assert_eq!(status, 204);
    until("dave's session ends as removed", || {
        dave.watch.ended() == Some(LiveEnd::Removed)
    })
    .await;
    dave.session.stop().await;
    ce.reseed();
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_link_sharing_off_ends_like_removal_and_a_link_viewer_is_restricted() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = alice_web
        .new_project("oleafly-ce-link-sharing", "none")
        .await;
    alice_web.share_by_link(&project, true).await;
    let token = alice_web.read_only_token(&project).await;
    let mut bob_web = Web::sign_in(&ce, "bob").await;
    bob_web.join_by_link(&token).await;
    let bob = live(&ce, &bob_web, &project, quick()).await;
    assert_eq!(bob.watch.role(), Some((Role::Viewer, false)));
    assert_eq!(bob.watch.seen().flags.first(), Some(&(true, false)));
    alice_web.share_by_link(&project, false).await;
    until("bob's session ends as removed", || {
        bob.watch.ended() == Some(LiveEnd::Removed)
    })
    .await;
    bob.session.stop().await;
    alice_web.delete_project(&project).await;
}

#[tokio::test(flavor = "multi_thread")]
async fn ce_a_deleted_project_ends_live_as_deleted() {
    let _turn = TURN.lock().await;
    let ce = Ce::load();
    let mut alice_web = Web::sign_in(&ce, "alice").await;
    let project = alice_web.new_project("oleafly-ce-deleted", "example").await;
    let slow = SessionTuning {
        trickle_every: Duration::from_secs(600),
        ..quick()
    };
    let alice = live(&ce, &alice_web, &project, slow).await;
    alice_web.delete_project(&project).await;
    for path in ["main.tex", "sample.bib"] {
        alice.session.open(path, Arc::new(|_| {}));
    }
    until("the session ends as deleted", || {
        alice.watch.ended() == Some(LiveEnd::ProjectGone)
    })
    .await;
    alice.session.stop().await;
}
