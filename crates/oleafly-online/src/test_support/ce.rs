use std::collections::BTreeMap;
use std::future::Future;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use oleafly_ot::testing::insertion;
use oleafly_ot::utf16_len;
use serde_json::{json, Value};
use tokio::sync::Mutex as TurnLock;

use crate::client::Http;
use crate::html;
use crate::live::format::DocFormat;
use crate::live::journal::Journal;
use crate::live::session::{
    DocStopReason, LivePeer, LivePort, LiveState, MergeReview, OverleafSession, SessionConfig,
    SessionTuning,
};
use crate::realtime::connection::Carrier;
use crate::realtime::events::{DocId, ProjectEvent, PublicId};
use crate::realtime::project::Role;
use crate::realtime::tree::PathChange;
use crate::session::{self, Session, SessionHandle};

pub const AGENT: &str = "Oleafly/ce-e2e";
pub const WAIT: Duration = Duration::from_secs(30);
pub const MAIN: &str = "main.tex";
pub const CONTAINER: &str = "oleafly-overleaf-ce-overleaf-1";
pub const DONE: &str = "OLEAFLY_DONE";
const WEB_NODE: &str =
    "source /etc/container_environment.sh && cd /overleaf/services/web && node --input-type=module -";
const HISTORY_NODE: &str = "source /etc/container_environment.sh && cd /overleaf/services/history-v1 && NODE_CONFIG_DIR=/overleaf/services/history-v1/config node -";
const HISTORY_ID: &str = "OLEAFLY_HISTORY ";
const DOCKER_DEADLINE: Duration = Duration::from_secs(150);

const ADD_MEMBER: &str = r"
const { default: CollaboratorsHandler } = await import('/overleaf/services/web/app/src/Features/Collaborators/CollaboratorsHandler.mjs')
await CollaboratorsHandler.promises.addUserIdToProject(@PROJECT@, @OWNER@, @USER@, @LEVEL@)
console.log('OLEAFLY_DONE')
process.exit(0)
";

const TO_HISTORY_OT: &str = r"
const { advanceOTMigrationStage } = await import('/overleaf/services/web/app/src/Features/History/HistoryOTMigration.mjs')
const { otMigrationStage } = await advanceOTMigrationStage(@PROJECT@, 1)
if (otMigrationStage === 1) console.log('OLEAFLY_DONE')
process.exit(0)
";

const FORGET_PROJECT: &str = r"
const { default: ProjectDeleter } = await import('/overleaf/services/web/app/src/Features/Project/ProjectDeleter.mjs')
const { db, ObjectId } = await import('/overleaf/services/web/app/src/infrastructure/mongodb.mjs')
const id = new ObjectId(@PROJECT@)
const live = await db.projects.findOne({ _id: id }, { projection: { 'overleaf.history.id': 1 } })
const deleted = await db.deletedProjects.findOne(
  { 'deleterData.deletedProjectId': id, project: { $ne: null } },
  { projection: { 'project.overleaf.history.id': 1 } }
)
const history = live?.overleaf?.history?.id ?? deleted?.project?.overleaf?.history?.id
if (history != null) console.log('OLEAFLY_HISTORY', String(history))
if (live) {
  await ProjectDeleter.promises.deleteProject(@PROJECT@)
}
if (await db.deletedProjects.findOne({ 'deleterData.deletedProjectId': id, project: { $ne: null } })) {
  await ProjectDeleter.promises.expireDeletedProject(@PROJECT@)
}
await db.deletedProjects.deleteMany({ 'deleterData.deletedProjectId': id })
await db.projectInvites.deleteMany({ projectId: id })
await db.notifications.deleteMany({ 'messageOpts.projectId': @PROJECT@ })
console.log('OLEAFLY_DONE')
process.exit(0)
";

const PURGE_HISTORY: &str = r"
const { ObjectId } = require('mongodb')
const { historyStore } = require('./storage/lib/history_store')
const { chunks } = require('./storage/lib/mongodb')
const chunkBackend = require('./storage/lib/chunk_store/mongo')
;(async () => {
  const gone = await chunks
    .find({ projectId: new ObjectId(@HISTORY@), state: { $in: ['deleted', 'pending'] } }, { projection: { _id: 1 } })
    .toArray()
  const ids = gone.map(chunk => chunk._id.toString())
  await historyStore.deleteChunks(ids.map(chunkId => ({ projectId: @HISTORY@, chunkId })))
  await chunkBackend.deleteOldChunks(ids)
  console.log('OLEAFLY_DONE')
  process.exit(0)
})().catch(error => {
  console.error(error)
  process.exit(1)
})
";

pub static TURN: TurnLock<()> = TurnLock::const_new(());
static SIGNED: Mutex<BTreeMap<String, Signed>> = Mutex::new(BTreeMap::new());

#[derive(Clone)]
struct Signed {
    cookies: BTreeMap<String, String>,
    csrf: String,
}

fn script(template: &str, values: &[(&str, &str)]) -> String {
    values
        .iter()
        .fold(template.to_string(), |text, (key, value)| {
            text.replace(&format!("@{key}@"), &json!(value).to_string())
        })
}

fn node(service: &str, template: &str, values: &[(&str, &str)]) -> Result<String, String> {
    let output = in_container(CONTAINER, service, &script(template, values))?;
    if output.contains(DONE) {
        Ok(output)
    } else {
        Err(output)
    }
}

pub fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis())
}

pub fn label(format: DocFormat) -> &'static str {
    match format {
        DocFormat::ShareJs => "sharejs",
        DocFormat::HistoryOt => "history-ot",
    }
}

pub fn docker_exec(container: &str, command: &str) -> Command {
    let mut docker = Command::new("docker");
    docker
        .args([
            "exec", "-i", container, "timeout", "120", "bash", "-c", command,
        ])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    docker
}

pub fn in_container(container: &str, command: &str, input: &str) -> Result<String, String> {
    let mut child = docker_exec(container, command)
        .spawn()
        .map_err(|error| format!("docker did not start: {error}"))?;
    let stdout = drain(child.stdout.take());
    let stderr = drain(child.stderr.take());
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(input.as_bytes()) {
            let _ = child.kill();
            return Err(format!("the script did not reach the container: {error}"));
        }
    }
    let started = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < DOCKER_DEADLINE => {
                std::thread::sleep(Duration::from_millis(20));
            }
            Ok(None) => {
                let _ = child.kill();
                return Err(format!(
                    "docker did not finish within {} s",
                    DOCKER_DEADLINE.as_secs()
                ));
            }
            Err(error) => return Err(format!("docker did not finish: {error}")),
        }
    };
    let stdout = String::from_utf8_lossy(&stdout.join().unwrap_or_default()).into_owned();
    if status.success() {
        Ok(stdout)
    } else {
        let stderr = stderr.join().unwrap_or_default();
        Err(format!("{stdout}{}", String::from_utf8_lossy(&stderr)))
    }
}

fn drain(pipe: Option<impl Read + Send + 'static>) -> std::thread::JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

pub struct Ce {
    pub dir: PathBuf,
    pub site: String,
    pub state: Value,
    env: BTreeMap<String, String>,
}

impl Ce {
    pub fn load() -> Ce {
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

    pub fn user_id(&self, who: &str) -> String {
        self.state["users"][who]["id"].as_str().unwrap().to_string()
    }

    pub fn email(&self, who: &str) -> String {
        self.state["users"][who]["email"]
            .as_str()
            .unwrap()
            .to_string()
    }

    fn password(&self, who: &str) -> String {
        self.env[&format!("{}_PASSWORD", who.to_uppercase())].clone()
    }

    fn add_member(&self, project: &str, who: &str, level: &str) {
        let (owner, user) = (self.user_id("alice"), self.user_id(who));
        node(
            WEB_NODE,
            ADD_MEMBER,
            &[
                ("PROJECT", project),
                ("OWNER", &owner),
                ("USER", &user),
                ("LEVEL", level),
            ],
        )
        .unwrap_or_else(|output| panic!("{who} did not become {level}: {output}"));
    }

    pub fn to_history_ot(&self, project: &str) {
        node(WEB_NODE, TO_HISTORY_OT, &[("PROJECT", project)])
            .unwrap_or_else(|output| panic!("{project} did not move to history-ot: {output}"));
    }

    fn forget_project(&self, project: &str) -> Result<(), String> {
        let output = node(WEB_NODE, FORGET_PROJECT, &[("PROJECT", project)])?;
        let Some(history) = output
            .lines()
            .find_map(|line| line.strip_prefix(HISTORY_ID))
        else {
            return Ok(());
        };
        node(HISTORY_NODE, PURGE_HISTORY, &[("HISTORY", history.trim())]).map(drop)
    }

    pub fn doc_state(&self, project: &str, doc: &DocId, raw: bool) -> Value {
        let query = if raw { "?historyOTSupport=true" } else { "" };
        let url = format!(
            "http://127.0.0.1:3003/project/{project}/doc/{}{query}",
            doc.0
        );
        let output = in_container(CONTAINER, &format!("curl -fsS '{url}'"), "")
            .expect("document-updater did not answer");
        serde_json::from_str(&output).unwrap()
    }

    pub fn server_text(&self, project: &str, doc: &DocId) -> String {
        self.doc_state(project, doc, false)["lines"]
            .as_array()
            .unwrap()
            .iter()
            .map(|line| line.as_str().unwrap())
            .collect::<Vec<_>>()
            .join("\n")
    }
}

pub struct Scratch<'a> {
    pub ce: &'a Ce,
    pub id: String,
}

impl Drop for Scratch<'_> {
    fn drop(&mut self) {
        if let Err(output) = self.ce.forget_project(&self.id) {
            eprintln!("the scratch project {} was not removed: {output}", self.id);
        }
    }
}

pub async fn scratch<'a>(
    ce: &'a Ce,
    owner: &mut Web,
    gate: &str,
    format: DocFormat,
    members: &[(&str, &str)],
) -> Scratch<'a> {
    let name = format!("oleafly-ce-{gate}-{}-{}", label(format), now_ms());
    let project = Scratch {
        ce,
        id: owner.new_project(&name, "example").await,
    };
    for (who, level) in members {
        ce.add_member(&project.id, who, level);
    }
    if format == DocFormat::HistoryOt {
        ce.to_history_ot(&project.id);
    }
    project
}

pub struct Web {
    site: String,
    client: reqwest::Client,
    cookies: BTreeMap<String, String>,
    pub csrf: String,
}

fn csrf_in(page: &str) -> Option<String> {
    html::meta_text(&html::meta_tags(page), "ol-csrfToken")
}

impl Web {
    pub async fn sign_in(ce: &Ce, who: &str) -> Web {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(WAIT)
            .build()
            .unwrap();
        let mut web = Web {
            site: ce.site.clone(),
            client,
            cookies: BTreeMap::new(),
            csrf: String::new(),
        };
        let signed = || SIGNED.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(known) = signed().get(who).cloned() {
            web.cookies = known.cookies;
            web.csrf = known.csrf;
            return web;
        }
        let page = web.page("/login").await;
        web.csrf = csrf_in(&page).expect("a CSRF token on the login page");
        let body =
            json!({ "email": ce.email(who), "password": ce.password(who), "_csrf": web.csrf });
        let (status, _) = web.call(reqwest::Method::POST, "/login", Some(body)).await;
        assert_eq!(status, 200, "{who} could not sign in");
        let page = web.page("/project").await;
        web.csrf = csrf_in(&page).expect("a CSRF token on the project list");
        signed().insert(
            who.to_string(),
            Signed {
                cookies: web.cookies.clone(),
                csrf: web.csrf.clone(),
            },
        );
        web
    }

    pub fn cookie(&self) -> String {
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

    pub async fn call(
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

    async fn new_project(&mut self, name: &str, template: &str) -> String {
        let body = json!({ "projectName": name, "template": template });
        let (status, reply) = self
            .call(reqwest::Method::POST, "/project/new", Some(body))
            .await;
        assert_eq!(status, 200, "creating {name}");
        reply["project_id"].as_str().unwrap().to_string()
    }
}

#[derive(Default)]
pub struct Seen {
    pub states: Vec<LiveState>,
    pub roles: Vec<(Role, bool)>,
    pub peers: Vec<LivePeer>,
    pub left: Vec<PublicId>,
    pub flags: Vec<(bool, bool)>,
    pub texts: Vec<DocId>,
    pub events: Vec<ProjectEvent>,
    pub filling: Vec<(usize, usize)>,
}

#[derive(Default)]
pub struct Watch {
    seen: Mutex<Seen>,
}

impl Watch {
    pub fn seen(&self) -> MutexGuard<'_, Seen> {
        self.seen.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn online(&self) -> bool {
        matches!(self.seen().states.last(), Some(LiveState::Online { .. }))
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

    fn project_event(&self, event: ProjectEvent) {
        self.seen().events.push(event);
    }

    fn merged(&self, _doc: &DocId, _review: MergeReview) {}

    fn journal_failed(&self, _reason: Option<String>) {}

    fn disk_text(&self, _path: &str) -> Option<String> {
        None
    }

    fn project_flags(&self, restricted: bool, deleted_externally: bool) {
        self.seen().flags.push((restricted, deleted_externally));
    }

    fn filling(&self, done: usize, total: usize) {
        self.seen().filling.push((done, total));
    }
}

struct DataDir(PathBuf);

impl Drop for DataDir {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_dir_all(&self.0) {
            eprintln!("{} was not removed: {error}", self.0.display());
        }
    }
}

pub struct Live {
    pub session: Arc<OverleafSession>,
    pub watch: Arc<Watch>,
    _data: DataDir,
}

pub async fn session_of(http: &Http, web: &Web) -> Session {
    session::session_from_cookie(http, web.cookie(), "ce-e2e")
        .await
        .unwrap()
}

pub async fn handle_of(ce: &Ce, http: &Http, web: &Web) -> SessionHandle {
    SessionHandle::new(&ce.site, session_of(http, web).await, None)
}

pub async fn live(ce: &Ce, web: &Web, project: &str, tuning: SessionTuning) -> Live {
    let http = Http::new(&ce.site, AGENT).unwrap();
    let handle = handle_of(ce, &http, web).await;
    start(ce, http, handle, project, tuning, false).await
}

pub async fn start(
    ce: &Ce,
    http: Http,
    handle: SessionHandle,
    project: &str,
    tuning: SessionTuning,
    fill: bool,
) -> Live {
    let data = DataDir(
        oleafly_core::test_support::test_data_dir("oleafly-ce-")
            .expect("a folder for the live journal"),
    );
    let journal = Journal::open(&data.0, &ce.site, project, None).unwrap();
    let watch = Arc::new(Watch::default());
    let config = SessionConfig {
        http,
        session: handle,
        project_id: project.to_string(),
        carriers: vec![Carrier::WebSocket, Carrier::XhrPolling],
        tuning,
        seeds: Vec::new(),
        fill,
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

pub fn quick() -> SessionTuning {
    SessionTuning {
        peer_reemit: Duration::from_millis(500),
        presence_with_peers: Duration::from_millis(100),
        ..SessionTuning::default()
    }
}

pub async fn until(what: &str, mut check: impl FnMut() -> bool) {
    eventually(what, || std::future::ready(check().then_some(()))).await
}

pub async fn eventually<T, F, Fut>(what: &str, mut check: F) -> T
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Option<T>>,
{
    let started = Instant::now();
    loop {
        if let Some(found) = check().await {
            return found;
        }
        assert!(started.elapsed() < WAIT, "timed out waiting until {what}");
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

pub fn open(live: &Live, path: &str) -> DocId {
    let opened = live
        .session
        .open(path, Arc::new(|_| {}))
        .expect("a live doc");
    DocId(opened.file_id)
}

pub async fn joined(live: &Live, doc: &DocId) {
    until("the doc is joined", || {
        live.watch.seen().texts.contains(doc) && live.session.text(doc).is_some()
    })
    .await;
}

pub async fn opened(live: &Live, path: &str) -> DocId {
    let doc = open(live, path);
    joined(live, &doc).await;
    doc
}

pub async fn append(live: &Live, doc: &DocId, text: &str) {
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

pub fn offset(text: &str, needle: &str) -> usize {
    let at = text
        .find(needle)
        .unwrap_or_else(|| panic!("{needle:?} is not in {text:?}"));
    utf16_len(&text[..at])
}

pub async fn insert_before(live: &Live, doc: &DocId, needle: &str, text: &str) {
    let added = live
        .session
        .local_edit_with(doc, |current| {
            Some(insertion(utf16_len(current), offset(current, needle), text))
        })
        .unwrap();
    assert!(added);
    assert!(live.session.settle(WAIT).await, "the insert was confirmed");
}
