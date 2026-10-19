use std::sync::{Arc, Mutex};

use oleafly_secrets::SecretStore;
use serde_json::json;

use crate::client::{self, Http};
use crate::error::OnlineErrorKind;
use crate::html;
use crate::projects::{self, imported_from, list_projects, ImportedFrom, RemoteProject};
use crate::service::{DEFAULT_SERVER, SERVICE_ID, SESSIONS_ACCOUNT};
use crate::session::{self, Session};
use crate::socket::{self, Packet, ProjectSettings};
use crate::test_support::{
    dashboard_page, frame, remote_project_json as remote, socket_handler, zip_bytes, FixtureServer,
    Reply, Request,
};

const AGENT: &str = "Oleafly/test";

fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn session_of(cookie: &str, user: &str) -> Session {
    Session {
        cookie: cookie.into(),
        user_id: user.into(),
        email: String::new(),
        saved_by: None,
    }
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
    assert_eq!(error.kind, OnlineErrorKind::SessionExpired);
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
    assert_eq!(session::normalize_server(None).unwrap(), DEFAULT_SERVER);
    assert_eq!(
        session::normalize_server(Some("overleaf.com")).unwrap(),
        DEFAULT_SERVER
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
        let error = session::normalize_server(Some(bad)).unwrap_err();
        assert_eq!(error.kind, OnlineErrorKind::InvalidServer, "{bad}");
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
        "site_session=s1; GCLB=old",
        [
            "GCLB=new; Path=/; HttpOnly",
            "site_session=s2; Secure",
            "gone=; Max-Age=0",
            "x",
        ],
    );
    assert_eq!(merged, "GCLB=new; site_session=s2");
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
    let project = projects::remote_project(&remote("a1", "Thesis"), "someone-else").unwrap();
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
    let shared = projects::remote_project(&shared, "user-1").unwrap();
    assert!(!shared.owned);
    assert_eq!(shared.name, "Untitled project");
    assert_eq!(shared.owner_name.as_deref(), Some("bob@x.org"));
    assert!(projects::remote_project(&json!({ "id": "t", "trashed": true }), "u").is_none());
    assert!(projects::remote_project(&json!({ "id": "../x" }), "u").is_none());
    assert!(projects::remote_project(&json!({ "name": "no id" }), "u").is_none());
}

#[tokio::test]
async fn http_calls_send_the_session_and_classify_replies() {
    let archive = zip_bytes(&[("main.tex", "\\documentclass{article}")]);
    let page = dashboard_page(&json!({ "totalSize": 1, "projects": [remote("a1", "Thesis")] }));
    let served_archive = archive.clone();
    let fixture = FixtureServer::start(Arc::new(move |request: &Request| {
        let signed_in = request
            .headers
            .get("cookie")
            .is_some_and(|cookie| cookie.contains("site_session=good"));
        match request.path.as_str() {
            "/project" if signed_in => {
                Reply::ok(page.clone()).header("Set-Cookie", "site_session=rotated; Path=/")
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
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let error = http.dashboard("site_session=bad").await.err().unwrap();
    assert_eq!(error.kind, OnlineErrorKind::SessionExpired);
    let dashboard = http.dashboard("site_session=good").await.unwrap();
    assert_eq!(
        dashboard.set_cookies,
        vec!["site_session=rotated; Path=/".to_string()]
    );
    let origin = fixture.requests("/project")[0]
        .headers
        .get("origin")
        .cloned();
    assert_eq!(origin.as_deref(), Some(fixture.base.as_str()));
    let listed = http
        .api_projects("site_session=good", "csrf-123", 5)
        .await
        .unwrap();
    assert_eq!(listed.len(), 1);
    let posted = fixture.requests("/api/project");
    assert!(posted[0].body.contains("\"size\":5"));
    assert_eq!(
        http.api_projects("site_session=good", "wrong", 5)
            .await
            .err()
            .unwrap()
            .kind,
        OnlineErrorKind::SessionExpired
    );

    let dir = tempfile::tempdir().unwrap();
    let destination = dir.path().join("a.zip");
    let mut seen = Vec::new();
    let bytes = http
        .download_zip(
            "site_session=good",
            "a1",
            &destination,
            |received, total| seen.push((received, total)),
        )
        .await
        .unwrap();
    assert_eq!(bytes, archive.len() as u64);
    assert_eq!(std::fs::read(&destination).unwrap(), archive);
    assert_eq!(seen.last(), Some(&(bytes, Some(bytes))));
    let kind_of = |error: crate::OnlineError| error.kind;
    assert_eq!(
        kind_of(
            http.download_zip("c", "html", &destination, |_, _| {})
                .await
                .unwrap_err()
        ),
        OnlineErrorKind::NotAnArchive
    );
    assert_eq!(
        kind_of(
            http.download_zip("c", "nothere", &destination, |_, _| {})
                .await
                .unwrap_err()
        ),
        OnlineErrorKind::ProjectUnavailable
    );
    assert_eq!(
        kind_of(
            http.download_zip("c", "limited", &destination, |_, _| {})
                .await
                .unwrap_err()
        ),
        OnlineErrorKind::RateLimited
    );
    assert_eq!(
        kind_of(
            http.download_zip("c", "../x", &destination, |_, _| {})
                .await
                .unwrap_err()
        ),
        OnlineErrorKind::ProjectUnavailable
    );
}

#[tokio::test]
async fn the_settings_exchange_answers_heartbeats_and_returns_the_project() {
    let project = json!({ "compiler": "lualatex", "rootDoc_id": "d", "rootFolder": [{ "docs": [{ "_id": "d", "name": "paper.tex" }] }] });
    let polls = Arc::new(Mutex::new(0));
    let socket = socket_handler(project, polls.clone());
    let fixture = FixtureServer::start(Arc::new(move |request: &Request| {
        socket(request).unwrap_or_else(|| Reply::status(404))
    }))
    .await;
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let fetched = socket::fetch_project(&http, "site_session=good", "a1")
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
    let fixture = FixtureServer::start(Arc::new(|request: &Request| {
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
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let error = socket::fetch_project(&http, "c", "a1").await.err().unwrap();
    assert_eq!(error.kind, OnlineErrorKind::Unreachable);
    assert!(error
        .detail
        .as_deref()
        .is_some_and(|detail| detail.contains("connectionRejected")));
}

#[test]
fn cookies_match_their_host_domain_path_and_scheme() {
    let url = |text: &str| url::Url::parse(text).unwrap();
    let site = url("https://www.example-latex.org");
    assert!(session::cookie_applies(
        Some(".example-latex.org"),
        Some("/"),
        true,
        &site
    ));
    assert!(session::cookie_applies(
        Some("example-latex.org"),
        None,
        true,
        &site
    ));
    assert!(session::cookie_applies(
        Some("www.example-latex.org"),
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
        Some("evil-example-latex.org"),
        Some("/"),
        false,
        &site
    ));
    assert!(!session::cookie_applies(
        Some(".example-latex.org"),
        Some("/"),
        true,
        &url("http://www.example-latex.org")
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

#[test]
fn sessions_persist_per_server_and_refresh_their_cookie() {
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    let first = session_of("a=1", "u");
    session::save(&store, "https://one.example", &first).unwrap();
    session::save(&store, "https://two.example", &session_of("b=2", "v")).unwrap();
    session::refresh_cookie(&store, "https://one.example", &first, "a=9").unwrap();
    assert_eq!(
        session::load(&store, "https://one.example")
            .unwrap()
            .unwrap()
            .cookie,
        "a=9"
    );
    // A refresh for a different account leaves the newer sign-in alone.
    session::refresh_cookie(&store, "https://two.example", &first, "stolen=1").unwrap();
    assert_eq!(
        session::load(&store, "https://two.example")
            .unwrap()
            .unwrap()
            .cookie,
        "b=2"
    );
    assert!(session::forget(&store, "https://one.example").unwrap());
    assert!(!session::forget(&store, "https://one.example").unwrap());
    assert!(session::load(&store, "https://one.example")
        .unwrap()
        .is_none());
    assert!(session::load(&store, "https://two.example")
        .unwrap()
        .is_some());
}

#[tokio::test]
async fn listing_without_a_session_asks_to_sign_in_and_an_expired_session_is_forgotten() {
    let fixture = FixtureServer::start(Arc::new(|_: &Request| {
        Reply::status(302).header("Location", "/login")
    }))
    .await;
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let error = list_projects(&http, &store).await.err().unwrap();
    assert_eq!(error.kind, OnlineErrorKind::SignedOut);
    session::save(&store, &fixture.base, &session_of("s=old", "u")).unwrap();
    assert!(session::load(&store, &fixture.base).unwrap().is_some());
    let error = list_projects(&http, &store).await.err().unwrap();
    assert_eq!(error.kind, OnlineErrorKind::SessionExpired);
    assert!(session::load(&store, &fixture.base).unwrap().is_none());
}

#[tokio::test]
async fn listing_returns_the_projects_newest_first_and_keeps_the_refreshed_cookie() {
    let page = dashboard_page(&json!({ "totalSize": 2, "projects": [
        { "id": "old1", "name": "Old", "lastUpdated": "2025-01-01T00:00:00.000Z", "accessLevel": "owner" },
        { "id": "new1", "name": "New", "lastUpdated": "2026-01-01T00:00:00.000Z", "accessLevel": "owner" }
    ] }));
    let fixture = FixtureServer::start(Arc::new(move |request: &Request| {
        if request.path == "/project" {
            Reply::ok(page.clone()).header("Set-Cookie", "site_session=rotated; Path=/")
        } else {
            Reply::status(404)
        }
    }))
    .await;
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    session::save(
        &store,
        &fixture.base,
        &session_of("site_session=old", "user-1"),
    )
    .unwrap();
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let (signed_in, listed) = list_projects(&http, &store).await.unwrap();
    let ids: Vec<_> = listed.iter().map(|project| project.id.as_str()).collect();
    assert_eq!(ids, vec!["new1", "old1"]);
    assert_eq!(signed_in.cookie, "site_session=rotated");
    assert_eq!(signed_in.email, "ada@uni.edu");
    assert_eq!(
        session::load(&store, &fixture.base)
            .unwrap()
            .unwrap()
            .cookie,
        "site_session=rotated"
    );
}

#[test]
fn a_0_4_7_session_map_loads() {
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    store
        .set(&[(
            SESSIONS_ACCOUNT,
            r#"{"https://latex.example.edu":{"cookie":"site_session=abc","userId":"u1","email":"a@b.edu"}}"#,
        )])
        .unwrap();
    let loaded = session::load(&store, "https://latex.example.edu")
        .unwrap()
        .unwrap();
    assert_eq!(
        (loaded.cookie.as_str(), loaded.saved_by),
        ("site_session=abc", None)
    );
}

#[test]
fn a_corrupt_session_map_reads_as_empty_and_is_replaced_on_save() {
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    store.set(&[(SESSIONS_ACCOUNT, "{not json")]).unwrap();
    assert_eq!(session::load(&store, "https://a.example").unwrap(), None);
    session::save(&store, "https://a.example", &session_of("a=1", "u")).unwrap();
    assert!(session::load(&store, "https://a.example")
        .unwrap()
        .is_some());
}

#[test]
fn session_and_dashboard_debug_never_show_cookies() {
    let signed_in = Session {
        cookie: "site_session=TOPSECRET".into(),
        user_id: "u".into(),
        email: "e".into(),
        saved_by: Some("cli".into()),
    };
    let printed = format!("{signed_in:?}");
    assert!(!printed.contains("TOPSECRET"));
    assert!(printed.contains("cli"));
    let dashboard = client::parse_dashboard(&dashboard_page(&json!({ "projects": [] }))).unwrap();
    assert!(!format!("{dashboard:?}").contains("csrf-123"));
}

#[test]
fn concurrent_session_saves_keep_both_servers() {
    let data = tempfile::tempdir().unwrap();
    let root = data.path().to_path_buf();
    let workers: Vec<_> = ["https://one.example", "https://two.example"]
        .into_iter()
        .map(|base| {
            let root = root.clone();
            std::thread::spawn(move || {
                let store = SecretStore::at(&root);
                for round in 0..50 {
                    session::save(&store, base, &session_of(&format!("c={round}"), "u")).unwrap();
                }
            })
        })
        .collect();
    for worker in workers {
        worker.join().unwrap();
    }
    let store = SecretStore::at(&root);
    for base in ["https://one.example", "https://two.example"] {
        assert_eq!(
            session::load(&store, base).unwrap().unwrap().cookie,
            "c=49",
            "{base}"
        );
    }
}

#[test]
fn default_server_is_the_only_saved_server_or_the_service_default() {
    let empty_dir = tempfile::tempdir().unwrap();
    let empty = SecretStore::at(empty_dir.path());
    assert_eq!(session::default_server(&empty).unwrap(), DEFAULT_SERVER);
    let data = tempfile::tempdir().unwrap();
    let store = SecretStore::at(data.path());
    session::save_git_token(&store, "https://latex.example.edu", "tok_12345678").unwrap();
    assert_eq!(
        session::default_server(&store).unwrap(),
        "https://latex.example.edu"
    );
    session::save(&store, "https://latex.example.edu", &session_of("a=1", "u")).unwrap();
    assert_eq!(
        session::default_server(&store).unwrap(),
        "https://latex.example.edu"
    );
    session::save(&store, "https://other.example.org", &session_of("b=2", "u")).unwrap();
    assert_eq!(session::default_server(&store).unwrap(), DEFAULT_SERVER);
    assert_eq!(
        session::git_token_servers(&store).unwrap(),
        vec!["https://latex.example.edu".to_string()]
    );
}

#[tokio::test]
async fn a_redirect_to_another_host_is_not_followed() {
    let other = FixtureServer::start(Arc::new(|_: &Request| Reply::ok("x"))).await;
    let target = format!("{}/steal", other.base);
    let first = FixtureServer::start(Arc::new(move |_: &Request| {
        Reply::status(302).header("Location", &target)
    }))
    .await;
    let http = Http::new(&first.base, AGENT).unwrap();
    assert!(http.dashboard("site_session=SECRET").await.is_err());
    assert!(other.requests("/").is_empty());
}

#[tokio::test]
async fn a_pasted_cookie_opens_a_session_that_names_who_saved_it() {
    let page = dashboard_page(&json!({ "projects": [] }));
    let fixture = FixtureServer::start(Arc::new(move |request: &Request| {
        if request.path == "/project" {
            Reply::ok(page.clone()).header("Set-Cookie", "extra=1; Path=/")
        } else {
            Reply::status(404)
        }
    }))
    .await;
    let http = Http::new(&fixture.base, AGENT).unwrap();
    let opened = session::session_from_cookie(&http, "site_session=good".into(), "cli")
        .await
        .unwrap();
    assert_eq!(opened.user_id, "user-1");
    assert_eq!(opened.saved_by.as_deref(), Some("cli"));
    assert_eq!(opened.cookie, "site_session=good; extra=1");
}

#[test]
fn imported_from_reads_only_records_of_this_service() {
    assert_eq!(
        imported_from(
            &json!({"service": SERVICE_ID, "server": "https://latex.example.edu", "projectId": "a1"})
        ),
        Some(ImportedFrom {
            server: "https://latex.example.edu".into(),
            project_id: "a1".into()
        })
    );
    assert_eq!(
        imported_from(&json!({"service": "other", "server": "s", "projectId": "a1"})),
        None
    );
    assert_eq!(imported_from(&json!({"service": SERVICE_ID})), None);
}

#[test]
fn imported_projects_map_remote_ids_to_local_folders() {
    let root = tempfile::tempdir().unwrap();
    let write = |id: &str, record: serde_json::Value| {
        let dir = root.path().join(id);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join("project.json"),
            json!({ "name": id, "importedFrom": record }).to_string(),
        )
        .unwrap();
    };
    write(
        "local-a",
        json!({"service": SERVICE_ID, "server": "https://latex.example.edu", "projectId": "r1"}),
    );
    write(
        "local-b",
        json!({"service": SERVICE_ID, "server": "https://elsewhere.example", "projectId": "r2"}),
    );
    let found = projects::imported_projects(root.path(), "https://latex.example.edu");
    assert_eq!(found.len(), 1);
    assert_eq!(found.get("r1").map(String::as_str), Some("local-a"));
}
