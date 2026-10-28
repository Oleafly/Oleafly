#![allow(dead_code)]

use std::collections::BTreeMap;
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use loro::{ExportMode, LoroDoc, VersionVector};
use oleafly_collab::doc::{NodeKind, ProjectDoc};
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::SharedProjectId;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::config::ServerConfig;
use oleafly_server::test_support::{no_redirect_client, test_config, TestServer};
use reqwest::header::{COOKIE, LOCATION, ORIGIN, SET_COOKIE};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use tokio::net::TcpStream;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::{connect_async, MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::people::{
    self, call, connect, create_project, grant, put_bytes, read, signed_by, subscribe, Person,
    Socket, Stage,
};

pub type WebSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

pub const MAIN_TEXT: &str = "Hello world\n";
pub const DESKTOP_PEER: u64 = 7_000;
pub const WAIT: Duration = Duration::from_secs(10);

pub fn web_config() -> ServerConfig {
    let mut config = test_config();
    config.web = true;
    config
}

pub async fn web_stage() -> Stage {
    people::stage_with(web_config()).await
}

#[derive(Debug, Default, Clone)]
pub struct Jar(BTreeMap<String, String>);

impl Jar {
    pub fn take(&mut self, response: &reqwest::Response) -> Vec<String> {
        let mut set = Vec::new();
        for value in response.headers().get_all(SET_COOKIE) {
            let Ok(text) = value.to_str() else {
                continue;
            };
            set.push(text.to_string());
            let Some((pair, _)) = text.split_once(';').or(Some((text, ""))) else {
                continue;
            };
            let Some((name, value)) = pair.split_once('=') else {
                continue;
            };
            if value.is_empty() || text.contains("Max-Age=0") {
                self.0.remove(name.trim());
            } else {
                self.0
                    .insert(name.trim().to_string(), value.trim().to_string());
            }
        }
        set
    }

    pub fn header(&self) -> String {
        self.0
            .iter()
            .map(|(name, value)| format!("{name}={value}"))
            .collect::<Vec<_>>()
            .join("; ")
    }

    pub fn get(&self, name: &str) -> Option<&str> {
        self.0.get(name).map(String::as_str)
    }

    pub fn without(&self, name: &str) -> Jar {
        let mut copy = self.clone();
        copy.0.remove(name);
        copy
    }
}

pub struct Browser {
    pub base: String,
    pub jar: Jar,
    pub landed: Url,
    pub session_cookie: String,
}

impl Browser {
    pub fn token(&self) -> &str {
        self.jar.get("oleafly_web").expect("a session cookie")
    }

    pub async fn get(&self, path: &str) -> reqwest::Response {
        reqwest::Client::new()
            .get(format!("{}{path}", self.base))
            .header(COOKIE, self.jar.header())
            .send()
            .await
            .expect("request")
    }

    pub async fn send(
        &self,
        method: Method,
        path: &str,
        origin: Option<&str>,
        marked: bool,
    ) -> reqwest::Response {
        let mut request = reqwest::Client::new()
            .request(method, format!("{}{path}", self.base))
            .header(COOKIE, self.jar.header());
        if let Some(origin) = origin {
            request = request.header(ORIGIN, origin);
        }
        if marked {
            request = request.header("X-Requested-With", "oleafly-web");
        }
        request.send().await.expect("request")
    }

    pub async fn sign_out(&self) -> reqwest::Response {
        self.send(Method::POST, "/web/api/sign-out", Some(&self.base), true)
            .await
    }

    pub async fn json(&self, path: &str) -> Value {
        let response = self.get(path).await;
        let status = response.status();
        assert!(status.is_success(), "{path} answered {status}");
        response.json().await.expect("json")
    }
}

pub fn start_url(server: &TestServer, provider: &str, return_to: &str) -> Url {
    let mut url = Url::parse(&format!("{}/auth/start", server.url())).expect("start url");
    url.query_pairs_mut()
        .append_pair("flow", "web")
        .append_pair("provider", provider)
        .append_pair("return", return_to);
    url
}

pub struct Followed {
    pub jar: Jar,
    pub last: reqwest::Response,
    pub url: Url,
    pub cookies: Vec<String>,
}

pub async fn follow(server: &TestServer, start: Url, mut jar: Jar) -> Followed {
    let client = no_redirect_client();
    let ours = Url::parse(&server.url()).expect("server url");
    let mut next = start;
    let mut cookies = Vec::new();
    for _ in 0..10 {
        let mut request = client.get(next.clone());
        if next.port() == ours.port() {
            request = request.header(COOKIE, jar.header());
        }
        let response = request.send().await.expect("request");
        if next.port() == ours.port() {
            cookies.extend(jar.take(&response));
        }
        let lands_on_web = next.port() == ours.port() && next.path().starts_with("/web");
        if !response.status().is_redirection() || lands_on_web {
            return Followed {
                jar,
                last: response,
                url: next,
                cookies,
            };
        }
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .expect("a location")
            .to_string();
        next = next.join(&location).expect("a redirect target");
    }
    panic!("too many redirects");
}

pub async fn browser_sign_in(server: &TestServer, provider: &str, return_to: &str) -> Browser {
    let followed = follow(
        server,
        start_url(server, provider, return_to),
        Jar::default(),
    )
    .await;
    assert!(
        followed.url.path().starts_with("/web"),
        "the sign-in ended at {} ({})",
        followed.url,
        followed.last.status()
    );
    let session_cookie = followed
        .cookies
        .iter()
        .find(|cookie| cookie.starts_with("oleafly_web="))
        .cloned()
        .expect("the session cookie was set");
    Browser {
        base: server.url(),
        jar: followed.jar,
        landed: followed.url,
        session_cookie,
    }
}

pub async fn open_socket(
    server: &TestServer,
    jar: &Jar,
    project: SharedProjectId,
    origin: Option<&str>,
) -> Result<WebSocket, tokio_tungstenite::tungstenite::Error> {
    let url = format!(
        "{}/web/ws?project={project}",
        server.url().replacen("http://", "ws://", 1)
    );
    let mut request = url.into_client_request().expect("a socket request");
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_str(origin).expect("origin"));
    }
    request.headers_mut().insert(
        "cookie",
        HeaderValue::from_str(&jar.header()).expect("cookie"),
    );
    connect_async(request).await.map(|(socket, _)| socket)
}

pub async fn web_socket(
    server: &TestServer,
    browser: &Browser,
    project: SharedProjectId,
) -> WebSocket {
    open_socket(server, &browser.jar, project, Some(&server.url()))
        .await
        .expect("the browser socket opens")
}

pub async fn next_web(socket: &mut WebSocket) -> Option<Value> {
    let waited = tokio::time::timeout(WAIT, async {
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Text(text)) => {
                    return Some(serde_json::from_str(text.as_str()).expect("a json frame"));
                }
                Ok(Message::Close(_)) | Err(_) => return None,
                Ok(_) => {}
            }
        }
        None
    })
    .await;
    waited.expect("a frame arrived in time")
}

pub async fn until(socket: &mut WebSocket, kind: &str) -> Value {
    loop {
        let frame = next_web(socket)
            .await
            .unwrap_or_else(|| panic!("the socket closed before a {kind} frame"));
        if frame["t"] == kind {
            return frame;
        }
    }
}

pub async fn until_where(socket: &mut WebSocket, wanted: impl Fn(&Value) -> bool) -> Value {
    loop {
        let frame = next_web(socket)
            .await
            .expect("the socket closed before the frame");
        if wanted(&frame) {
            return frame;
        }
    }
}

pub async fn send_web(socket: &mut WebSocket, frame: Value) {
    socket
        .send(Message::text(frame.to_string()))
        .await
        .expect("send a frame");
}

pub async fn ends(socket: &mut WebSocket) -> bool {
    tokio::time::timeout(WAIT, async {
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Close(_)) | Err(_) => return true,
                Ok(_) => {}
            }
        }
        true
    })
    .await
    .unwrap_or(false)
}

pub struct Shared {
    pub project: SharedProjectId,
    pub main: String,
    pub figure: String,
    pub snapshot: Vec<u8>,
}

pub fn project_doc() -> (ProjectDoc, String, String) {
    let mut doc = ProjectDoc::create().expect("a project");
    let main = doc
        .add_node(None, "main.tex", NodeKind::Text, None, MAIN_TEXT)
        .expect("main file");
    let figures = doc
        .add_node(None, "figures", NodeKind::Dir, None, "")
        .expect("folder");
    let figure = doc
        .add_node(
            Some(&figures),
            "plot.png",
            NodeKind::Blob,
            Some(&"a".repeat(64)),
            "",
        )
        .expect("figure");
    (doc, main, figure)
}

pub async fn share_doc_project(stage: &Stage, role: ProjectRole) -> Shared {
    let (doc, main, figure) = project_doc();
    let snapshot = doc.snapshot().expect("snapshot");
    let created = create_project(&stage.server, &stage.bob, "Thesis").await;
    let project = created.project_id;
    let uploaded = put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{project}/snapshot?seq=0"),
        stage.bob.token(),
        snapshot.clone(),
    )
    .await;
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let _: Value = read(
        call(
            &stage.server,
            Method::POST,
            &format!("/api/v1/projects/{project}/commit"),
            stage.bob.token(),
            None,
        )
        .await,
    )
    .await;
    assert_eq!(
        grant(&stage.server, &stage.bob, project, &stage.alice, role)
            .await
            .status(),
        StatusCode::OK
    );
    Shared {
        project,
        main,
        figure,
        snapshot,
    }
}

pub struct Desktop {
    pub doc: LoroDoc,
    pub socket: Socket,
    pub sent: VersionVector,
    pub project: SharedProjectId,
}

impl Desktop {
    pub async fn open(stage: &Stage, person: &Person, shared: &Shared, peer: u64) -> Desktop {
        let doc = LoroDoc::new();
        doc.import(&shared.snapshot).expect("the snapshot loads");
        doc.set_peer_id(peer).expect("peer");
        let mut socket = connect(&stage.server, person).await;
        assert!(matches!(
            subscribe(&mut socket, shared.project, 0).await,
            ServerFrame::Subscribed { .. }
        ));
        let sent = doc.oplog_vv();
        Desktop {
            doc,
            socket,
            sent,
            project: shared.project,
        }
    }

    pub fn text(&self, file: &str) -> String {
        self.doc.get_text(format!("text:{file}")).to_string()
    }

    pub fn project_doc(&self) -> ProjectDoc {
        let snapshot = self.doc.export(ExportMode::Snapshot).expect("snapshot");
        ProjectDoc::load(&snapshot).expect("the desktop copy loads")
    }

    pub async fn type_at(
        &mut self,
        person: &Person,
        file: &str,
        at: usize,
        text: &str,
    ) -> ServerFrame {
        self.doc
            .get_text(format!("text:{file}"))
            .insert(at, text)
            .expect("insert");
        self.doc.commit();
        let update = self
            .doc
            .export(ExportMode::updates(&self.sent))
            .expect("update");
        self.send(person, &update).await
    }

    pub async fn send(&mut self, person: &Person, update: &[u8]) -> ServerFrame {
        self.sent = self.doc.oplog_vv();
        let envelope = signed_by(person, &person.device, self.project, update);
        people::send_update(&mut self.socket, &envelope).await;
        loop {
            match people::next_frame(&mut self.socket).await.expect("a reply") {
                ServerFrame::Ack { .. } => {
                    return ServerFrame::Ack {
                        project_id: self.project,
                        batch_id: envelope.batch_id,
                        seq: 0,
                    }
                }
                ServerFrame::Error { code, message } => {
                    return ServerFrame::Error { code, message }
                }
                ServerFrame::Update { envelope, .. } => {
                    self.doc.import(&envelope.payload).expect("import");
                }
                _ => {}
            }
        }
    }

    pub async fn hear_update(&mut self) {
        loop {
            if let ServerFrame::Update { envelope, .. } =
                people::next_frame(&mut self.socket).await.expect("a frame")
            {
                self.doc.import(&envelope.payload).expect("import");
                self.sent = self.doc.oplog_vv();
                return;
            }
        }
    }

    pub async fn hear_frame(&mut self, wanted: impl Fn(&ServerFrame) -> bool) -> ServerFrame {
        loop {
            let frame = people::next_frame(&mut self.socket).await.expect("a frame");
            if let ServerFrame::Update { envelope, .. } = &frame {
                self.doc.import(&envelope.payload).expect("import");
                self.sent = self.doc.oplog_vv();
            }
            if wanted(&frame) {
                return frame;
            }
        }
    }
}

pub fn insert_at(position: usize, text: &str, length: usize) -> Value {
    let mut op: Vec<Value> = Vec::new();
    if position > 0 {
        op.push(json!(position));
    }
    op.push(json!(text));
    if length > position {
        op.push(json!(length - position));
    }
    Value::Array(op)
}

pub fn utf16(text: &str) -> usize {
    text.encode_utf16().count()
}
