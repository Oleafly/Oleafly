use std::collections::HashMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex};

use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::client::{self, Http};
use super::html;
use super::import::{self, ImportEvent, RemoteProject};
use super::session::{self, Session};
use super::signin;
use super::socket::{self, Packet, ProjectSettings};

#[derive(Clone, Debug)]
struct Request {
    method: String,
    path: String,
    headers: HashMap<String, String>,
    body: String,
}

#[derive(Clone)]
struct Reply {
    status: u16,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
}

impl Reply {
    fn ok(body: impl Into<Vec<u8>>) -> Self {
        Self {
            status: 200,
            headers: Vec::new(),
            body: body.into(),
        }
    }

    fn status(status: u16) -> Self {
        Self {
            status,
            headers: Vec::new(),
            body: Vec::new(),
        }
    }

    fn header(mut self, name: &str, value: &str) -> Self {
        self.headers.push((name.to_string(), value.to_string()));
        self
    }
}

type Handler = Arc<dyn Fn(&Request) -> Reply + Send + Sync>;

struct Fixture {
    base: String,
    requests: Arc<Mutex<Vec<Request>>>,
}

impl Fixture {
    fn requests(&self, prefix: &str) -> Vec<Request> {
        self.requests
            .lock()
            .unwrap()
            .iter()
            .filter(|request| request.path.starts_with(prefix))
            .cloned()
            .collect()
    }
}

async fn read_request(stream: &mut tokio::net::TcpStream) -> Option<Request> {
    let mut raw = Vec::new();
    let mut buffer = [0_u8; 4096];
    let head_end = loop {
        if let Some(at) = raw.windows(4).position(|window| window == b"\r\n\r\n") {
            break at;
        }
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            return None;
        }
        raw.extend_from_slice(&buffer[..read]);
    };
    let head = String::from_utf8_lossy(&raw[..head_end]).to_string();
    let mut lines = head.split("\r\n");
    let mut first = lines.next()?.split_whitespace();
    let method = first.next()?.to_string();
    let path = first.next()?.to_string();
    let headers: HashMap<String, String> = lines
        .filter_map(|line| line.split_once(':'))
        .map(|(name, value)| (name.trim().to_ascii_lowercase(), value.trim().to_string()))
        .collect();
    let length: usize = headers
        .get("content-length")
        .and_then(|value| value.parse().ok())
        .unwrap_or(0);
    let mut body = raw[head_end + 4..].to_vec();
    while body.len() < length {
        let read = stream.read(&mut buffer).await.ok()?;
        if read == 0 {
            break;
        }
        body.extend_from_slice(&buffer[..read]);
    }
    Some(Request {
        method,
        path,
        headers,
        body: String::from_utf8_lossy(&body).to_string(),
    })
}

async fn serve(handler: Handler) -> Fixture {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let requests: Arc<Mutex<Vec<Request>>> = Arc::default();
    let recorded = requests.clone();
    tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let handler = handler.clone();
            let recorded = recorded.clone();
            tokio::spawn(async move {
                let Some(request) = read_request(&mut stream).await else {
                    return;
                };
                recorded.lock().unwrap().push(request.clone());
                let reply = handler(&request);
                let mut head = format!(
                    "HTTP/1.1 {} X\r\nContent-Length: {}\r\nConnection: close\r\n",
                    reply.status,
                    reply.body.len()
                );
                for (name, value) in &reply.headers {
                    head.push_str(&format!("{name}: {value}\r\n"));
                }
                head.push_str("\r\n");
                let _ = stream.write_all(head.as_bytes()).await;
                let _ = stream.write_all(&reply.body).await;
            });
        }
    });
    Fixture { base, requests }
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn dashboard_page(projects: &serde_json::Value) -> String {
    format!(
        "<!DOCTYPE html><html><head>\
         <meta name=\"ol-csrfToken\" content=\"csrf-123\">\
         <meta content=\"user-1\" name=\"ol-user_id\">\
         <meta name=\"ol-usersEmail\" content=\"ada@uni.edu\">\
         <meta name=\"ol-prefetchedProjectsBlob\" data-type=\"json\" content=\"{}\">\
         </head><body></body></html>",
        escape(&projects.to_string())
    )
}

fn remote(id: &str, name: &str) -> serde_json::Value {
    json!({
        "id": id,
        "name": name,
        "lastUpdated": "2026-10-01T10:00:00.000Z",
        "accessLevel": "owner",
        "owner": { "id": "user-1", "firstName": "Ada", "lastName": "Lovelace", "email": "ada@uni.edu" },
        "lastUpdatedBy": { "firstName": "Grace", "lastName": "Hopper" },
        "archived": false,
        "trashed": false
    })
}

fn project_reply(project: &serde_json::Value) -> String {
    let event = json!({ "name": "joinProjectResponse", "args": [{ "publicId": "p", "project": project, "permissionsLevel": "owner", "protocolVersion": 2 }] });
    frame(&[&format!("5:::{event}")])
}

fn frame(packets: &[&str]) -> String {
    let marker = char::REPLACEMENT_CHARACTER;
    packets
        .iter()
        .map(|packet| format!("{marker}{}{marker}{packet}", packet.encode_utf16().count()))
        .collect()
}

fn zip_bytes(files: &[(&str, &str)]) -> Vec<u8> {
    let mut cursor = std::io::Cursor::new(Vec::new());
    {
        let mut writer = zip::ZipWriter::new(&mut cursor);
        let options = zip::write::SimpleFileOptions::default();
        for (name, body) in files {
            writer.start_file(*name, options).unwrap();
            writer.write_all(body.as_bytes()).unwrap();
        }
        writer.finish().unwrap();
    }
    cursor.into_inner()
}

#[test]
fn meta_tags_read_any_attribute_order_quotes_and_entities() {
    let page = r#"<head><META content='{"a":"x &amp; y"}' name=ol-blob><meta name="ol-csrfToken" content="t&#39;k&#x41;"/><meta property="og:title" content="skip"><meta name="ol-user_id" content="&quot;u1&quot;"></head>"#;
    let tags = html::meta_tags(page);
    assert_eq!(tags.get("ol-blob").unwrap(), r#"{"a":"x & y"}"#);
    assert_eq!(tags.get("ol-csrfToken").unwrap(), "t'kA");
    assert!(!tags.contains_key("og:title"));
    assert_eq!(html::meta_text(&tags, "ol-user_id").as_deref(), Some("u1"));
    assert_eq!(
        html::decode_entities("a &bogus; b &amp"),
        "a &bogus; b &amp"
    );
}

#[test]
fn the_dashboard_yields_identity_and_projects_or_reads_as_signed_out() {
    let page = dashboard_page(
        &json!({ "totalSize": 3, "projects": [remote("a1", "Thesis"), remote("b2", "Paper")] }),
    );
    let dashboard = client::parse_dashboard(&page).unwrap();
    assert_eq!(dashboard.user_id, "user-1");
    assert_eq!(dashboard.email, "ada@uni.edu");
    assert_eq!(dashboard.csrf.as_deref(), Some("csrf-123"));
    assert_eq!(dashboard.projects.as_ref().map(Vec::len), Some(2));
    assert!(client::needs_api(&dashboard));
    assert_eq!(client::api_size(&dashboard), 1_000);
    let login = "<html><head><meta name=\"ol-csrfToken\" content=\"x\"></head></html>";
    let error = client::parse_dashboard(login).err().unwrap();
    assert!(client::is_expired(&error));
}

#[test]
fn older_project_list_shapes_still_parse() {
    let generic = format!(
        "<meta name=\"ol-user_id\" content=\"u\"><meta name=\"ol-data\" content=\"{}\">",
        escape(&json!({ "projects": [remote("c3", "Old")] }).to_string())
    );
    let dashboard = client::parse_dashboard(&generic).unwrap();
    assert_eq!(dashboard.projects.unwrap()[0]["id"], "c3");
    let legacy = format!(
        "<meta name=\"ol-user_id\" content=\"u\"><meta name=\"ol-projects\" content=\"{}\">",
        escape(&json!([remote("d4", "Legacy")]).to_string())
    );
    let dashboard = client::parse_dashboard(&legacy).unwrap();
    assert_eq!(dashboard.projects.unwrap()[0]["id"], "d4");
    assert!(!client::needs_api(
        &client::parse_dashboard(&dashboard_page(&json!({ "projects": [] }))).unwrap()
    ));
}

#[test]
fn servers_normalize_to_a_base_without_trailing_slash() {
    assert_eq!(
        session::normalize_server(None).unwrap(),
        "https://www.overleaf.com"
    );
    assert_eq!(
        session::normalize_server(Some("overleaf.com")).unwrap(),
        "https://www.overleaf.com"
    );
    assert_eq!(
        session::normalize_server(Some(" https://LaTeX.uni.edu/sharelatex/ ")).unwrap(),
        "https://latex.uni.edu/sharelatex"
    );
    assert_eq!(
        session::normalize_server(Some("http://127.0.0.1:8080")).unwrap(),
        "http://127.0.0.1:8080"
    );
    for bad in [
        "ftp://x.org",
        "https://user:pw@x.org",
        "https://x.org/?q=1",
        "https://",
    ] {
        assert!(session::normalize_server(Some(bad)).is_err(), "{bad}");
    }
    assert_eq!(
        session::origin_of("https://latex.uni.edu/sharelatex"),
        "https://latex.uni.edu"
    );
}

#[test]
fn cookie_headers_dedupe_and_follow_set_cookie() {
    assert_eq!(
        session::cookie_header([
            ("a", "1"),
            ("b", "2"),
            ("a", "3"),
            ("bad;name", "x"),
            ("c", "x;y")
        ]),
        "a=3; b=2"
    );
    let merged = session::merge_set_cookies(
        "overleaf_session2=s1; GCLB=old",
        [
            "GCLB=new; Path=/; HttpOnly",
            "overleaf_session2=s2; Secure",
            "gone=; Max-Age=0",
            "x",
        ],
    );
    assert_eq!(merged, "GCLB=new; overleaf_session2=s2");
    assert_eq!(session::merge_set_cookies("a=1", ["a=2; Max-Age=0"]), "");
}

#[test]
fn socket_payloads_split_frames_by_utf16_length() {
    let packets = frame(&["1::", "5:::{\"name\":\"x\",\"args\":[\"é😀\"]}"]);
    let decoded = socket::decode_payload(&packets);
    assert_eq!(decoded.len(), 2);
    assert_eq!(decoded[0], "1::");
    assert!(decoded[1].ends_with("😀\"]}"));
    assert_eq!(socket::decode_payload("2::"), vec!["2::".to_string()]);
    assert!(socket::decode_payload("").is_empty());
    assert_eq!(socket::parse_packet("2::"), Packet::Heartbeat);
    assert_eq!(socket::parse_packet("1::"), Packet::Connect);
    assert_eq!(socket::parse_packet("0::"), Packet::Disconnect);
    assert_eq!(
        socket::parse_packet("7:::bad:origin"),
        Packet::Error("bad:origin".into())
    );
    assert_eq!(
        socket::parse_packet("5:::{\"name\":\"n\",\"args\":[1]}"),
        Packet::Event {
            name: "n".into(),
            args: vec![json!(1)]
        }
    );
    assert_eq!(socket::parse_packet("5:::nope"), Packet::Other);
}

#[test]
fn project_settings_resolve_the_main_document_path() {
    let project = json!({
        "compiler": "xelatex",
        "imageName": "quay.io/sharelatex/texlive-full:2025.1",
        "rootDoc_id": "doc-9",
        "rootFolder": [{
            "_id": "root", "name": "rootFolder",
            "docs": [{ "_id": "doc-1", "name": "notes.tex" }],
            "folders": [{ "_id": "f", "name": "thesis", "docs": [{ "_id": "doc-9", "name": "main.tex" }], "folders": [] }]
        }]
    });
    assert_eq!(
        socket::settings_from_project(&project),
        ProjectSettings {
            compiler: Some("xelatex".into()),
            main_doc: Some("thesis/main.tex".into()),
            tex_live: Some("2025".into()),
        }
    );
    assert_eq!(
        socket::settings_from_project(&json!({})),
        ProjectSettings::default()
    );
    assert_eq!(
        socket::tex_live_year("texlive-full:2024.1"),
        Some("2024".into())
    );
    assert_eq!(socket::tex_live_year("latest"), None);
    assert_eq!(socket::flavor_for_compiler("PDFLaTeX"), Some("pdflatex"));
    assert_eq!(socket::flavor_for_compiler("lualatex"), Some("lualatex"));
    assert_eq!(socket::flavor_for_compiler("latex"), None);
}

#[test]
fn remote_projects_normalize_owner_access_and_skip_trash() {
    let project = import::remote_project(&remote("a1", "Thesis"), "someone-else").unwrap();
    assert_eq!(
        project,
        RemoteProject {
            id: "a1".into(),
            name: "Thesis".into(),
            owner_name: Some("Ada Lovelace".into()),
            owned: true,
            access: "owner".into(),
            last_updated: Some("2026-10-01T10:00:00.000Z".into()),
            last_updated_by: Some("Grace Hopper".into()),
            archived: false,
            imported_as: None,
        }
    );
    let shared = json!({ "_id": "b2", "name": " ", "accessLevel": "readAndWrite", "owner": { "_id": "x", "email": "bob@x.org" } });
    let shared = import::remote_project(&shared, "user-1").unwrap();
    assert!(!shared.owned);
    assert_eq!(shared.name, "Untitled project");
    assert_eq!(shared.owner_name.as_deref(), Some("bob@x.org"));
    assert!(import::remote_project(&json!({ "id": "t", "trashed": true }), "u").is_none());
    assert!(import::remote_project(&json!({ "id": "../x" }), "u").is_none());
    assert!(import::remote_project(&json!({ "name": "no id" }), "u").is_none());
}

#[test]
fn dashboard_urls_match_only_the_project_list() {
    let url = |text: &str| tauri::Url::parse(text).unwrap();
    assert!(signin::is_dashboard(
        &url("https://www.overleaf.com/project"),
        "https://www.overleaf.com"
    ));
    assert!(signin::is_dashboard(
        &url("https://www.overleaf.com/project/"),
        "https://www.overleaf.com"
    ));
    assert!(!signin::is_dashboard(
        &url("https://www.overleaf.com/project/abc"),
        "https://www.overleaf.com"
    ));
    assert!(!signin::is_dashboard(
        &url("https://evil.example/project"),
        "https://www.overleaf.com"
    ));
    assert!(signin::is_dashboard(
        &url("https://latex.uni.edu/sl/project"),
        "https://latex.uni.edu/sl"
    ));
    assert!(!signin::is_dashboard(
        &url("https://latex.uni.edu/project"),
        "https://latex.uni.edu/sl"
    ));
    assert!(signin::cancelled().contains("\"overleaf.sign_in_cancelled\""));
}

#[tokio::test]
async fn http_calls_send_the_session_and_classify_replies() {
    let archive = zip_bytes(&[("main.tex", "\\documentclass{article}")]);
    let page = dashboard_page(&json!({ "totalSize": 1, "projects": [remote("a1", "Thesis")] }));
    let served_archive = archive.clone();
    let fixture = serve(Arc::new(move |request: &Request| {
        let signed_in = request
            .headers
            .get("cookie")
            .is_some_and(|cookie| cookie.contains("overleaf_session2=good"));
        match request.path.as_str() {
            "/project" if signed_in => {
                Reply::ok(page.clone()).header("Set-Cookie", "overleaf_session2=rotated; Path=/")
            }
            "/project" => Reply::status(302).header("Location", "/login?redir=%2Fproject"),
            "/api/project" if request.method == "POST" => {
                if request.headers.get("x-csrf-token").map(String::as_str) == Some("csrf-123") {
                    Reply::ok(
                        json!({ "totalSize": 1, "projects": [remote("a1", "Thesis")] }).to_string(),
                    )
                } else {
                    Reply::status(403)
                }
            }
            "/project/a1/download/zip" => Reply::ok(served_archive.clone()),
            "/project/html/download/zip" => Reply::ok("<html></html>"),
            "/project/limited/download/zip" => Reply::status(429),
            _ => Reply::status(404),
        }
    }))
    .await;
    let http = Http::new(&fixture.base).unwrap();
    let error = http.dashboard("overleaf_session2=bad").await.err().unwrap();
    assert!(client::is_expired(&error));
    let dashboard = http.dashboard("overleaf_session2=good").await.unwrap();
    assert_eq!(
        dashboard.set_cookies,
        vec!["overleaf_session2=rotated; Path=/".to_string()]
    );
    let origin = fixture.requests("/project")[0]
        .headers
        .get("origin")
        .cloned();
    assert_eq!(origin.as_deref(), Some(fixture.base.as_str()));
    let listed = http
        .api_projects("overleaf_session2=good", "csrf-123", 5)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    let posted = fixture.requests("/api/project");
    assert!(posted[0].body.contains("\"size\":5"));
    assert!(client::is_expired(
        &http
            .api_projects("overleaf_session2=good", "wrong", 5)
            .await
            .err()
            .unwrap()
    ));

    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("a.zip");
    let mut seen = Vec::new();
    let bytes = http
        .download_zip(
            "overleaf_session2=good",
            "a1",
            &destination,
            |received, total| seen.push((received, total)),
        )
        .await
        .unwrap();
    assert_eq!(bytes, archive.len() as u64);
    assert_eq!(std::fs::read(&destination).unwrap(), archive);
    assert_eq!(seen.last(), Some(&(bytes, Some(bytes))));
    let not_zip = http
        .download_zip("c", "html", &destination, |_, _| {})
        .await
        .err()
        .unwrap();
    assert!(not_zip.contains("overleaf.not_an_archive"));
    let missing = http
        .download_zip("c", "nothere", &destination, |_, _| {})
        .await
        .err()
        .unwrap();
    assert!(missing.contains("overleaf.project_unavailable"));
    let limited = http
        .download_zip("c", "limited", &destination, |_, _| {})
        .await
        .err()
        .unwrap();
    assert!(limited.contains("overleaf.rate_limited"));
    let bad_id = http
        .download_zip("c", "../x", &destination, |_, _| {})
        .await
        .err()
        .unwrap();
    assert!(bad_id.contains("overleaf.project_unavailable"));
}

fn socket_handler(
    project: serde_json::Value,
    polls: Arc<Mutex<usize>>,
) -> impl Fn(&Request) -> Option<Reply> {
    move |request: &Request| {
        let path = request.path.as_str();
        if path.starts_with("/socket.io/socket.io.js") {
            return Some(Reply::ok("js").header("Set-Cookie", "GCLB=affinity; Path=/"));
        }
        if path.starts_with("/socket.io/1/?projectId=") {
            if request
                .headers
                .get("cookie")
                .is_some_and(|cookie| cookie.contains("GCLB=affinity"))
            {
                return Some(Reply::ok("sid-7:60:60:websocket,xhr-polling"));
            }
            return Some(Reply::status(403));
        }
        if path.starts_with("/socket.io/1/xhr-polling/sid-7") {
            if request.method == "POST" {
                return Some(Reply::ok("1"));
            }
            let mut count = polls.lock().unwrap();
            *count += 1;
            return Some(match *count {
                1 => Reply::ok(frame(&["1::", "2::"])),
                _ => Reply::ok(project_reply(&project)),
            });
        }
        None
    }
}

#[tokio::test]
async fn the_settings_exchange_answers_heartbeats_and_returns_the_project() {
    let project = json!({ "compiler": "lualatex", "rootDoc_id": "d", "rootFolder": [{ "docs": [{ "_id": "d", "name": "paper.tex" }] }] });
    let polls = Arc::new(Mutex::new(0));
    let socket = socket_handler(project, polls.clone());
    let fixture = serve(Arc::new(move |request: &Request| {
        socket(request).unwrap_or_else(|| Reply::status(404))
    }))
    .await;
    let http = Http::new(&fixture.base).unwrap();
    let fetched = socket::fetch_project(&http, "overleaf_session2=good", "a1")
        .await
        .unwrap();
    assert_eq!(
        socket::settings_from_project(&fetched).main_doc.as_deref(),
        Some("paper.tex")
    );
    assert_eq!(*polls.lock().unwrap(), 2);
    let posts: Vec<String> = fixture
        .requests("/socket.io/1/xhr-polling/")
        .into_iter()
        .filter(|request| request.method == "POST")
        .map(|request| request.body)
        .collect();
    assert_eq!(posts, vec!["2::".to_string(), "0::".to_string()]);
    assert!(fixture.requests("/socket.io/1/?projectId=a1").len() == 1);
}

#[tokio::test]
async fn the_settings_exchange_reports_a_rejected_connection() {
    let fixture = serve(Arc::new(|request: &Request| {
        if request.path.starts_with("/socket.io/1/?") {
            Reply::ok("sid-1:60:60:xhr-polling")
        } else if request.path.starts_with("/socket.io/1/xhr-polling/sid-1")
            && request.method == "GET"
        {
            Reply::ok(frame(&[
                "5:::{\"name\":\"connectionRejected\",\"args\":[{\"message\":\"no\"}]}",
            ]))
        } else {
            Reply::ok("")
        }
    }))
    .await;
    let http = Http::new(&fixture.base).unwrap();
    let error = socket::fetch_project(&http, "c", "a1").await.err().unwrap();
    assert!(error.contains("connectionRejected"));
}

#[test]
fn importing_downloads_each_project_and_carries_its_settings() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap();
    let result = runtime.block_on(async {
        let page = dashboard_page(&json!({ "totalSize": 2, "projects": [remote("a1", "Thesis"), remote("b2", "Broken")] }));
        let archive = zip_bytes(&[
            ("thesis/main.tex", "\\documentclass{book}\\begin{document}x\\end{document}"),
            ("notes.tex", "\\documentclass{article}\\begin{document}y\\end{document}"),
        ]);
        let project = json!({
            "compiler": "xelatex",
            "imageName": "texlive-full:2025.1",
            "rootDoc_id": "m",
            "rootFolder": [{ "docs": [{ "_id": "n", "name": "notes.tex" }], "folders": [{ "name": "thesis", "docs": [{ "_id": "m", "name": "main.tex" }] }] }]
        });
        let socket = socket_handler(project, Arc::new(Mutex::new(0)));
        let fixture = serve(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(&base, &Session { cookie: "overleaf_session2=good".into(), user_id: "user-1".into(), email: "ada@uni.edu".into() }).unwrap();
        let events: Mutex<Vec<ImportEvent>> = Mutex::new(Vec::new());
        let emit = |event: ImportEvent| events.lock().unwrap().push(event);
        let outcomes = import::import(&base, &["a1".to_string(), "b2".to_string(), "a1".to_string(), "zz".to_string()], &emit)
            .await
            .unwrap();
        (base, outcomes, events.into_inner().unwrap())
    });
    let (base, outcomes, events) = result;
    assert_eq!(outcomes.len(), 3);
    let imported = outcomes
        .iter()
        .find(|outcome| outcome.remote_id == "a1")
        .unwrap();
    let project_id = imported.project_id.clone().unwrap();
    for failed in ["b2", "zz"] {
        let outcome = outcomes
            .iter()
            .find(|outcome| outcome.remote_id == failed)
            .unwrap();
        assert!(
            outcome
                .error
                .as_deref()
                .unwrap()
                .contains("overleaf.project_unavailable"),
            "{failed}"
        );
    }
    let meta_path = crate::paths::projects_root()
        .unwrap()
        .join(&project_id)
        .join("project.json");
    let meta: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(meta_path).unwrap()).unwrap();
    assert_eq!(meta["name"], "Thesis");
    assert_eq!(meta["main_doc"], "thesis/main.tex");
    assert_eq!(meta["engine"], "latexmk");
    assert_eq!(meta["tex_flavor"], "xelatex");
    assert_eq!(meta["importedFrom"]["projectId"], "a1");
    assert_eq!(meta["importedFrom"]["server"], base.as_str());
    assert_eq!(meta["importedFrom"]["texLive"], "2025");
    assert!(events.iter().any(
        |event| matches!(event, ImportEvent::Downloading { remote_id, .. } if remote_id == "a1")
    ));
    assert!(events
        .iter()
        .any(|event| matches!(event, ImportEvent::Importing { remote_id } if remote_id == "a1")));
    assert!(events.iter().any(|event| matches!(event, ImportEvent::Done { remote_id, main_doc, .. } if remote_id == "a1" && main_doc.as_deref() == Some("thesis/main.tex"))));
    assert_eq!(
        import::imported_projects(&base).get("a1"),
        Some(&project_id)
    );
    let leftovers: Vec<_> = std::fs::read_dir(crate::paths::projects_root().unwrap())
        .unwrap()
        .flatten()
        .filter(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with(".oleafly-online-import")
        })
        .collect();
    assert!(leftovers.is_empty());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn listing_without_a_session_asks_to_sign_in_and_an_expired_session_is_forgotten() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(1)
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let fixture = serve(Arc::new(|_: &Request| {
            Reply::status(302).header("Location", "/login")
        }))
        .await;
        let base = fixture.base.clone();
        let error = import::list(&base).await.err().unwrap();
        assert!(error.contains("overleaf.signed_out"));
        session::save(
            &base,
            &Session {
                cookie: "s=old".into(),
                user_id: "u".into(),
                email: String::new(),
            },
        )
        .unwrap();
        assert!(session::load(&base).unwrap().is_some());
        let error = import::list(&base).await.err().unwrap();
        assert!(client::is_expired(&error));
        assert!(session::load(&base).unwrap().is_none());
    });
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn sessions_persist_per_server_and_refresh_their_cookie() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let first = Session {
        cookie: "a=1".into(),
        user_id: "u".into(),
        email: "e".into(),
    };
    session::save("https://one.example", &first).unwrap();
    session::save(
        "https://two.example",
        &Session {
            cookie: "b=2".into(),
            user_id: "v".into(),
            email: String::new(),
        },
    )
    .unwrap();
    session::refresh_cookie("https://one.example", &first, "a=9").unwrap();
    assert_eq!(
        session::load("https://one.example")
            .unwrap()
            .unwrap()
            .cookie,
        "a=9"
    );
    session::forget("https://one.example").unwrap();
    assert!(session::load("https://one.example").unwrap().is_none());
    assert!(session::load("https://two.example").unwrap().is_some());
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn cookies_match_their_host_domain_path_and_scheme() {
    let url = |text: &str| tauri::Url::parse(text).unwrap();
    let site = url("https://www.overleaf.com");
    assert!(session::cookie_applies(
        Some(".overleaf.com"),
        Some("/"),
        true,
        &site
    ));
    assert!(session::cookie_applies(
        Some("overleaf.com"),
        None,
        true,
        &site
    ));
    assert!(session::cookie_applies(
        Some("www.overleaf.com"),
        Some("/"),
        true,
        &site
    ));
    assert!(session::cookie_applies(None, None, false, &site));
    assert!(!session::cookie_applies(
        Some(".google.com"),
        Some("/"),
        true,
        &site
    ));
    assert!(!session::cookie_applies(
        Some("evil-overleaf.com"),
        Some("/"),
        false,
        &site
    ));
    assert!(!session::cookie_applies(
        Some(".overleaf.com"),
        Some("/"),
        true,
        &url("http://www.overleaf.com")
    ));
    let local = url("http://127.0.0.1:41234");
    assert!(session::cookie_applies(
        Some("127.0.0.1"),
        Some("/"),
        false,
        &local
    ));
    assert!(session::cookie_applies(
        Some("127.0.0.1"),
        Some("/"),
        true,
        &local
    ));
    assert!(!session::cookie_applies(
        Some("0.0.1"),
        Some("/"),
        false,
        &local
    ));
    let nested = url("https://latex.uni.edu/sharelatex");
    assert!(session::cookie_applies(
        Some("latex.uni.edu"),
        Some("/sharelatex"),
        true,
        &nested
    ));
    assert!(session::cookie_applies(
        Some("latex.uni.edu"),
        Some("/sharelatex/"),
        true,
        &url("https://latex.uni.edu/sharelatex/project")
    ));
    assert!(!session::cookie_applies(
        Some("latex.uni.edu"),
        Some("/other"),
        true,
        &nested
    ));
}

// --- Gallery templates and account projects as custom templates -----------

use super::template;

fn gallery_page(page: &str) -> String {
    format!(
        "<!DOCTYPE html><html><head><meta name=\"og:title\" content=\"Lab Thesis &amp; Report\">\
         <meta name=\"ol-csrfToken\" content=\"public-token\"></head><body>\
         <h1 class=\"h2\">Lab Thesis</h1>\
         <a class=\"btn btn-primary\" href=\"/project/new/template/123?brandVariationId=7&amp;id=456&amp;latexEngine=pdflatex&amp;mainFile=thesis%2Fmain.tex&amp;templateName=Lab+Thesis&amp;texImage=texlive-full%3A2025.1\">Open as Template</a>\
         <a class=\"btn\" href=\"{page}.pdf\" target=\"_blank\">View PDF</a>\
         <div class=\"template-detail\"><div><b>Author:</b></div><div>Ada <i>Lovelace</i></div></div>\
         <div class=\"template-detail\"><div><b>License:</b></div><div>Creative Commons CC BY 4.0</div></div>\
         <div class=\"template-detail\"><div><b>Abstract:</b></div><div class=\"gallery-abstract\"><p>A thesis</p>\n<p>for the lab &lt;group&gt;.</p></div></div>\
         </body></html>"
    )
}

#[test]
fn gallery_links_are_accepted_from_any_language_and_from_the_import_server() {
    let default = session::DEFAULT_SERVER;
    let page = "/latex/templates/ieee-conference-template/grfzhhncsfqn";
    for link in [
        "https://www.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn",
        "de.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn/",
        "https://overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn.pdf",
        "  https://www.overleaf.com/latex/templates/ieee-conference-template/grfzhhncsfqn?ref=x  ",
    ] {
        let parsed = template::parse_link(link, default).unwrap();
        assert_eq!(parsed.base, default, "{link}");
        assert_eq!(parsed.page, page, "{link}");
    }
    for link in [
        "https://www.overleaf.com/latex/examples/a-tikz-figure/abc123",
        "https://www.overleaf.com/articles/a-paper/abc123",
    ] {
        assert!(template::parse_link(link, default).is_ok(), "{link}");
    }
    for link in [
        "https://example.com/latex/templates/x/abc",
        "https://www.overleaf.com/project/64a1",
        "https://www.overleaf.com/latex/templates/x",
        "https://www.overleaf.com/latex/templates/x/abc/extra",
        "ftp://www.overleaf.com/latex/templates/x/abc",
        "https://www.overleaf.com/latex/templates/x%20y/abc",
        "not a link",
    ] {
        let error = template::parse_link(link, default).unwrap_err();
        assert!(
            error.contains("overleaf.template_link_invalid"),
            "{link}: {error}"
        );
    }
    let university = "https://latex.uni.edu/sharelatex";
    let parsed = template::parse_link(
        "https://latex.uni.edu/sharelatex/latex/templates/lab/abc",
        university,
    )
    .unwrap();
    assert_eq!(parsed.base, university);
    assert_eq!(parsed.page, "/latex/templates/lab/abc");
    assert_eq!(
        parsed.url(),
        "https://latex.uni.edu/sharelatex/latex/templates/lab/abc"
    );
    assert!(template::parse_link(
        "https://latex.uni.edu/other/latex/templates/lab/abc",
        university
    )
    .is_err());
}

#[test]
fn a_gallery_page_yields_its_details_and_the_request_that_copies_it() {
    let page_path = "/latex/templates/lab-thesis/abc";
    let page = template::parse_page(&gallery_page(page_path), page_path);
    assert_eq!(page.title.as_deref(), Some("Lab Thesis & Report"));
    assert_eq!(page.author.as_deref(), Some("Ada Lovelace"));
    assert_eq!(page.license.as_deref(), Some("Creative Commons CC BY 4.0"));
    assert_eq!(
        page.description.as_deref(),
        Some("A thesis for the lab <group>.")
    );
    assert!(page.has_pdf);
    let open = page.open.clone().unwrap();
    assert_eq!(open.version_id, "123");
    assert_eq!(open.template_id, "456");
    assert_eq!(open.main_file.as_deref(), Some("thesis/main.tex"));
    assert_eq!(open.image.as_deref(), Some("texlive-full:2025.1"));
    assert_eq!(
        template::create_body(&open, " My thesis "),
        json!({
            "templateId": "456",
            "templateVersionId": "123",
            "templateName": "My thesis",
            "compiler": "pdflatex",
            "mainFile": "thesis/main.tex",
            "imageName": "texlive-full:2025.1",
            "brandVariationId": "7",
        })
    );
    let dvi = template::OpenAsTemplate {
        engine: Some("latex_dvipdf".into()),
        ..open
    };
    assert_eq!(template::create_body(&dvi, "")["compiler"], "latex");
    assert!(template::create_body(&dvi, "")
        .get("templateName")
        .is_none());

    let bare = template::parse_page("<html><body><h1>Nothing</h1></body></html>", page_path);
    assert!(bare.open.is_none());
    assert!(!bare.has_pdf);
    let forged = template::parse_page(
        "<a href=\"/project/new/template/12x?id=4\">Open</a>",
        page_path,
    );
    assert!(forged.open.is_none());

    assert_eq!(client::project_id_in("/project/64ab"), Some("64ab".into()));
    assert_eq!(
        client::project_id_in("https://www.overleaf.com/project/64ab?x=1"),
        Some("64ab".into())
    );
    assert_eq!(
        client::project_id_in("/sharelatex/project/64ab/"),
        Some("64ab".into())
    );
    assert_eq!(client::project_id_in("/login?redir=/project/64ab"), None);
    assert_eq!(client::project_id_in("/project/new/template"), None);
}

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}

fn custom_template_dirs() -> Vec<std::path::PathBuf> {
    let root = crate::templates::custom_templates_root().unwrap();
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    entries.flatten().map(|entry| entry.path()).collect()
}

#[test]
fn a_gallery_link_is_copied_into_the_account_and_saved_as_a_template() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let page_path = "/latex/templates/lab-thesis/abc";
    let (base, result, posts) = run(async {
        let page = gallery_page(page_path);
        let dashboard = dashboard_page(&json!({ "projects": [] }));
        let archive = zip_bytes(&[
            (
                "thesis/main.tex",
                "\\documentclass{report}\\begin{document}x\\end{document}",
            ),
            ("thesis/LICENSE", "CC BY"),
            ("logo.png", "png"),
        ]);
        let fixture = serve(Arc::new(move |request: &Request| {
            match (request.method.as_str(), request.path.as_str()) {
                ("GET", "/project") => Reply::ok(dashboard.clone()),
                ("GET", path) if path == page_path => Reply::ok(page.clone()),
                ("POST", "/project/new/template") => {
                    Reply::status(302).header("Location", "/project/p-new")
                }
                ("GET", "/project/p-new/download/zip") => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: "ada@uni.edu".into(),
            },
        )
        .unwrap();
        let result = template::import_template(
            Some(&base),
            &format!("{base}{page_path}"),
            "Our lab thesis".into(),
            None,
            Vec::new(),
        )
        .await;
        (base, result, fixture.requests("/project/new/template"))
    });
    let id = result.unwrap();
    let dir = crate::templates::custom_templates_root().unwrap().join(&id);
    let manifest = crate::templates::read_manifest(&dir).unwrap();
    assert_eq!(manifest.name, "Our lab thesis");
    assert_eq!(manifest.category, "Custom");
    assert_eq!(manifest.main_doc, "thesis/main.tex");
    assert_eq!(manifest.tex_flavor.as_deref(), Some("pdflatex"));
    assert_eq!(manifest.description, "A thesis for the lab <group>.");
    let license = manifest.license.unwrap();
    assert_eq!(license.spdx, "Creative Commons CC BY 4.0");
    assert_eq!(license.author, "Ada Lovelace");
    assert_eq!(license.url, format!("{base}{page_path}"));
    assert!(dir.join("files/thesis/LICENSE").is_file());
    assert!(dir.join("files/logo.png").is_file());
    assert_eq!(posts.len(), 1);
    let post = &posts[0];
    assert_eq!(
        post.headers.get("x-csrf-token").map(String::as_str),
        Some("csrf-123")
    );
    assert!(post
        .headers
        .get("cookie")
        .unwrap()
        .contains("overleaf_session2=good"));
    let body: serde_json::Value = serde_json::from_str(&post.body).unwrap();
    assert_eq!(body["templateId"], "456");
    assert_eq!(body["templateVersionId"], "123");
    assert_eq!(body["templateName"], "Our lab thesis");
    assert_eq!(custom_template_dirs(), vec![dir]);
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn a_gallery_link_needs_a_sign_in_and_reports_removed_templates_and_expired_sign_ins() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let page_path = "/latex/templates/lab-thesis/abc";
    let (signed_out, removed, expired, still_signed_in) = run(async {
        let page = gallery_page(page_path);
        let dashboard = dashboard_page(&json!({ "projects": [] }));
        let fixture = serve(Arc::new(move |request: &Request| {
            match (request.method.as_str(), request.path.as_str()) {
                ("GET", "/project") => Reply::ok(dashboard.clone()),
                ("GET", path) if path == page_path => Reply::ok(page.clone()),
                ("POST", "/project/new/template") => {
                    Reply::status(302).header("Location", "/login?redir=%2Fproject")
                }
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        let link = format!("{base}{page_path}");
        let signed_out =
            template::import_template(Some(&base), &link, "x".into(), None, Vec::new()).await;
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: String::new(),
            },
        )
        .unwrap();
        let removed = template::overleaf_template_details(
            Some(base.clone()),
            format!("{base}/latex/templates/gone/zzz"),
        )
        .await;
        let expired =
            template::import_template(Some(&base), &link, "x".into(), None, Vec::new()).await;
        let still_signed_in = session::load(&base).unwrap().is_some();
        (signed_out, removed, expired, still_signed_in)
    });
    assert!(signed_out.unwrap_err().contains("overleaf.signed_out"));
    assert!(removed
        .unwrap_err()
        .contains("overleaf.template_unavailable"));
    assert!(client::is_expired(&expired.unwrap_err()));
    assert!(!still_signed_in, "an expired sign-in is forgotten");
    assert!(custom_template_dirs().iter().all(|path| !path
        .file_name()
        .unwrap()
        .to_string_lossy()
        .starts_with(".download-")));
    std::env::remove_var("OLEAFLY_DATA_DIR");
}

#[test]
fn an_account_project_is_saved_as_a_template_with_its_main_file_and_compiler() {
    let _guard = crate::paths::data_dir_env_lock();
    let data = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", data.path());
    let (result, missing) = run(async {
        let page = dashboard_page(&json!({ "projects": [remote("a1", "Lab master")] }));
        let archive = zip_bytes(&[
            (
                "thesis/main.tex",
                "\\documentclass{book}\\begin{document}x\\end{document}",
            ),
            (
                "notes.tex",
                "\\documentclass{article}\\begin{document}y\\end{document}",
            ),
        ]);
        let project = json!({
            "compiler": "xelatex",
            "rootDoc_id": "m",
            "rootFolder": [{ "docs": [{ "_id": "n", "name": "notes.tex" }], "folders": [{ "name": "thesis", "docs": [{ "_id": "m", "name": "main.tex" }] }] }]
        });
        let socket = socket_handler(project, Arc::new(Mutex::new(0)));
        let fixture = serve(Arc::new(move |request: &Request| {
            if let Some(reply) = socket(request) {
                return reply;
            }
            match request.path.as_str() {
                "/project" => Reply::ok(page.clone()),
                "/project/a1/download/zip" => Reply::ok(archive.clone()),
                _ => Reply::status(404),
            }
        }))
        .await;
        let base = fixture.base.clone();
        session::save(
            &base,
            &Session {
                cookie: "overleaf_session2=good".into(),
                user_id: "user-1".into(),
                email: String::new(),
            },
        )
        .unwrap();
        let result =
            template::save_project_as_template(Some(&base), "a1", "Lab master".into(), Vec::new())
                .await;
        let missing =
            template::save_project_as_template(Some(&base), "zz", "Gone".into(), Vec::new()).await;
        (result, missing)
    });
    let id = result.unwrap();
    let manifest = crate::templates::read_manifest(
        &crate::templates::custom_templates_root().unwrap().join(&id),
    )
    .unwrap();
    assert_eq!(manifest.name, "Lab master");
    assert_eq!(manifest.main_doc, "thesis/main.tex");
    assert_eq!(manifest.tex_flavor.as_deref(), Some("xelatex"));
    assert!(missing
        .unwrap_err()
        .contains("overleaf.project_unavailable"));
    let projects = crate::paths::projects_root().unwrap();
    assert!(std::fs::read_dir(projects).map_or(true, |mut entries| entries.next().is_none()));
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
