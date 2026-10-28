#![cfg(feature = "web")]

mod people;
mod web_support;

use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::outputs::MAIN_FILE_HEADER;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::blobs::sha256_hex;
use oleafly_server::config::DEFAULT_WEB_CONNECT_SRC;
use oleafly_server::test_support::TestServer;
use people::{call, grant, put_bytes};
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use web_support::{
    browser_sign_in, share_doc_project, until, web_config, web_socket, web_stage, Browser, Desktop,
    DESKTOP_PEER, MAIN_TEXT,
};

fn header(response: &reqwest::Response, name: &str) -> String {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

#[tokio::test]
async fn the_project_list_and_a_project_describe_what_the_browser_shows() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let listed = browser.json("/web/api/projects").await;
    let projects = listed["projects"].as_array().expect("a list");
    assert_eq!(projects.len(), 1);
    let entry = &projects[0];
    assert_eq!(entry["id"], Value::String(shared.project.to_string()));
    assert_eq!(entry["name"], "Thesis");
    assert_eq!(entry["title"], "Thesis");
    assert_eq!(entry["role"], "editor");
    assert_eq!(entry["ownerName"], "Bob Smith");
    assert_eq!(entry["owner"]["displayName"], "Bob Smith");
    assert!(entry["updatedAt"].as_i64().unwrap_or_default() > 0);
    let detail = browser
        .json(&format!("/web/api/projects/{}", shared.project))
        .await;
    assert_eq!(detail["role"], "editor");
    assert_eq!(detail["project"]["name"], "Thesis");
    assert_eq!(detail["features"]["comments"], true);
    assert_eq!(detail["features"]["suggestions"], true);
    assert_eq!(detail["features"]["chat"], true);
    let files = detail["files"].as_array().expect("files");
    let find = |path: &str| {
        files
            .iter()
            .find(|file| file["path"] == path)
            .cloned()
            .unwrap_or_else(|| panic!("{path} is listed in {files:?}"))
    };
    assert_eq!(find("main.tex")["kind"], "text");
    assert_eq!(
        find("main.tex")["fileId"],
        Value::String(shared.main.clone())
    );
    assert!(find("main.tex").get("hash").is_none());
    assert_eq!(find("figures")["kind"], "dir");
    assert_eq!(find("figures/plot.png")["kind"], "blob");
    assert_eq!(find("figures/plot.png")["hash"], "a".repeat(64));
    let members = detail["members"].as_array().expect("members");
    let names: Vec<&str> = members
        .iter()
        .filter_map(|member| member["displayName"].as_str())
        .collect();
    assert!(
        names.contains(&"Bob Smith") && names.contains(&"Alice Chen"),
        "{names:?}"
    );
    assert!(members
        .iter()
        .all(|member| member.get("accountId").is_some()));
}

#[tokio::test]
async fn without_a_session_or_access_the_api_says_so() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Viewer).await;
    let anonymous = reqwest::Client::new()
        .get(format!("{}/web/api/me", stage.server.url()))
        .send()
        .await
        .expect("request");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let body: Value = anonymous.json().await.expect("json");
    assert_eq!(body["code"], "unauthorized");
    let browser = browser_sign_in(&stage.server, "github", "/web/").await;
    let other = people::create_project(&stage.server, &stage.alice, "Alice only").await;
    let refused = browser
        .get(&format!("/web/api/projects/{}", other.project_id))
        .await;
    assert_eq!(refused.status(), StatusCode::NOT_FOUND);
    let unknown = browser.get("/web/api/nothing-here").await;
    assert_eq!(unknown.status(), StatusCode::NOT_FOUND);
    let body: Value = unknown.json().await.expect("json");
    assert_eq!(body["code"], "not_found");
    let own = browser
        .get(&format!("/web/api/projects/{}", shared.project))
        .await;
    assert_eq!(own.status(), StatusCode::OK);
}

#[tokio::test]
async fn stored_files_come_back_typed_and_sandboxed() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Viewer).await;
    let mut png = b"\x89PNG\r\n\x1a\n".to_vec();
    png.extend_from_slice(b"pixels");
    let hash = sha256_hex(&png);
    let uploaded = put_bytes(
        &stage.server,
        &format!("/api/v1/projects/{}/blobs/{hash}", shared.project),
        stage.bob.token(),
        png.clone(),
    )
    .await;
    assert_eq!(uploaded.status(), StatusCode::NO_CONTENT);
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let blob = browser
        .get(&format!(
            "/web/api/projects/{}/blobs/{hash}",
            shared.project
        ))
        .await;
    assert_eq!(blob.status(), StatusCode::OK);
    assert_eq!(header(&blob, "content-type"), "image/png");
    assert_eq!(header(&blob, "x-content-type-options"), "nosniff");
    assert!(header(&blob, "content-security-policy").contains("sandbox"));
    assert_eq!(header(&blob, "content-disposition"), "attachment");
    assert_eq!(blob.bytes().await.expect("bytes").to_vec(), png);
    let missing = browser
        .get(&format!(
            "/web/api/projects/{}/blobs/{}",
            shared.project,
            sha256_hex(b"absent")
        ))
        .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_latest_compiled_pdf_is_listed_and_served() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Viewer).await;
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let empty = browser
        .json(&format!("/web/api/projects/{}/output", shared.project))
        .await;
    assert_eq!(empty["items"], Value::Array(Vec::new()));
    let none = browser
        .get(&format!("/web/api/projects/{}/output/pdf", shared.project))
        .await;
    assert_eq!(none.status(), StatusCode::NOT_FOUND);
    let pdf = b"%PDF-1.7\nbody".to_vec();
    let stored = reqwest::Client::new()
        .put(format!(
            "{}/api/v1/projects/{}/output/pdf",
            stage.server.url(),
            shared.project
        ))
        .bearer_auth(stage.bob.token())
        .header(MAIN_FILE_HEADER, "main.tex")
        .body(pdf.clone())
        .send()
        .await
        .expect("upload");
    assert_eq!(stored.status(), StatusCode::OK);
    let listed = browser
        .json(&format!("/web/api/projects/{}/output", shared.project))
        .await;
    let item = &listed["items"][0];
    assert_eq!(item["kind"], "pdf");
    assert_eq!(item["size"], pdf.len());
    assert_eq!(item["mainFile"], "main.tex");
    assert_eq!(
        item["compiledBy"],
        Value::String(stage.bob.tokens.account_id.to_string())
    );
    let served = browser
        .get(&format!("/web/api/projects/{}/output/pdf", shared.project))
        .await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(header(&served, "content-type"), "application/pdf");
    assert_eq!(served.bytes().await.expect("bytes").to_vec(), pdf);
}

#[tokio::test]
async fn the_app_page_carries_its_security_headers_and_the_bare_path_moves_to_the_app() {
    let stage = web_stage().await;
    for path in ["/web/", "/web/projects/abc"] {
        let page = reqwest::Client::new()
            .get(format!("{}{path}", stage.server.url()))
            .send()
            .await
            .expect("page");
        assert!(
            page.status() == StatusCode::OK || page.status() == StatusCode::SERVICE_UNAVAILABLE,
            "{path} answered {}",
            page.status()
        );
        let policy = header(&page, "content-security-policy");
        assert!(policy.contains("default-src 'self'"), "{policy}");
        assert!(
            policy.contains("script-src 'self' 'wasm-unsafe-eval';"),
            "{policy}"
        );
        assert!(
            policy.contains(&format!("connect-src 'self' {DEFAULT_WEB_CONNECT_SRC};")),
            "{policy}"
        );
        assert!(
            policy.contains("img-src 'self' data: blob: https:"),
            "{policy}"
        );
        assert!(policy.contains("frame-ancestors 'none'"), "{policy}");
        assert_eq!(header(&page, "x-content-type-options"), "nosniff");
        assert_eq!(header(&page, "x-frame-options"), "DENY");
        assert_eq!(header(&page, "referrer-policy"), "same-origin");
        assert!(header(&page, CONTENT_TYPE.as_str()).starts_with("text/html"));
    }
    let missing = reqwest::Client::new()
        .get(format!("{}/web/assets/none-0000.js", stage.server.url()))
        .send()
        .await
        .expect("asset");
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    let bare = oleafly_server::test_support::no_redirect_client()
        .get(format!("{}/web?project=p", stage.server.url()))
        .send()
        .await
        .expect("bare");
    assert_eq!(bare.status(), StatusCode::FOUND);
    assert_eq!(header(&bare, LOCATION.as_str()), "/web/?project=p");
}

#[tokio::test]
async fn the_project_landing_page_offers_the_browser_only_when_it_is_on() {
    let on = web_stage().await;
    let shared = share_doc_project(&on, ProjectRole::Viewer).await;
    let page = reqwest::Client::new()
        .get(format!("{}/p/{}", on.server.url(), shared.project))
        .send()
        .await
        .expect("landing")
        .text()
        .await
        .expect("html");
    assert!(page.contains("Open in browser"), "{page}");
    assert!(
        page.contains(&format!("/web/?project={}", shared.project)),
        "{page}"
    );
    let off = people::stage().await;
    let page = reqwest::Client::new()
        .get(format!("{}/p/{}", off.server.url(), shared.project))
        .send()
        .await
        .expect("landing")
        .text()
        .await
        .expect("html");
    assert!(!page.contains("Open in browser"), "{page}");
}

#[tokio::test]
async fn the_page_policy_names_the_origins_the_server_is_set_to_allow() {
    let mut config = web_config();
    config.web_connect_src = vec![
        "https://mirror.example.org".to_string(),
        "http://localhost:5173".to_string(),
    ];
    let server = TestServer::start(config).await;
    let page = reqwest::Client::new()
        .get(format!("{}/web/", server.url()))
        .send()
        .await
        .expect("page");
    let policy = header(&page, "content-security-policy");
    assert!(
        policy.contains("; connect-src 'self' https://mirror.example.org http://localhost:5173;"),
        "{policy}"
    );
    assert!(policy.contains("'wasm-unsafe-eval'"), "{policy}");
    assert!(!policy.contains(DEFAULT_WEB_CONNECT_SRC), "{policy}");
}

const ABSTRACT: &str = "01920000-0000-7000-8000-0000000000e2";

fn texts_of(project: impl std::fmt::Display) -> String {
    format!("/web/api/projects/{project}/texts")
}

#[tokio::test]
async fn every_text_file_comes_back_in_one_answer_sorted_by_path() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Commenter).await;
    let mut desktop = Desktop::open(&stage, &stage.bob, &shared, DESKTOP_PEER).await;
    let tree = desktop.doc.get_tree("tree");
    let node = tree.create(loro::TreeParentId::Root).expect("a new file");
    let meta = tree.get_meta(node).expect("meta");
    meta.insert("id", ABSTRACT).expect("id");
    meta.insert("name", "abstract.tex").expect("name");
    meta.insert("kind", "text").expect("kind");
    assert!(matches!(
        desktop
            .type_at(&stage.bob, ABSTRACT, 0, "We study sea ice.\n")
            .await,
        ServerFrame::Ack { .. }
    ));
    let browser = browser_sign_in(&stage.server, "github2", "/web/").await;
    let answer = browser.get(&texts_of(shared.project)).await;
    assert_eq!(answer.status(), StatusCode::OK);
    assert_eq!(header(&answer, "cache-control"), "no-store");
    assert_eq!(header(&answer, "x-content-type-options"), "nosniff");
    let body: Value = answer.json().await.expect("json");
    assert_eq!(
        body,
        json!({ "files": [
            { "fileId": ABSTRACT, "path": "abstract.tex", "text": "We study sea ice.\n" },
            { "fileId": shared.main, "path": "main.tex", "text": MAIN_TEXT },
        ] })
    );
}

#[tokio::test]
async fn texts_need_a_session_and_an_active_project_the_caller_is_in() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Viewer).await;
    let anonymous = reqwest::Client::new()
        .get(format!(
            "{}{}",
            stage.server.url(),
            texts_of(shared.project)
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let bob = browser_sign_in(&stage.server, "github", "/web/").await;
    let alice = browser_sign_in(&stage.server, "github2", "/web/").await;
    let pending = people::create_project(&stage.server, &stage.alice, "Alice only").await;
    let outsider = bob.get(&texts_of(pending.project_id)).await;
    assert_eq!(outsider.status(), StatusCode::NOT_FOUND);
    let not_shared = alice.get(&texts_of(pending.project_id)).await;
    assert_eq!(not_shared.status(), StatusCode::NOT_FOUND);
    let body: Value = not_shared.json().await.expect("json");
    assert_eq!(body["code"], "project_not_shared");
    assert_eq!(
        alice.get(&texts_of(shared.project)).await.status(),
        StatusCode::OK
    );
    let archived = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{}/archive", shared.project),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let owner = bob.get(&texts_of(shared.project)).await;
    assert_eq!(owner.status(), StatusCode::NOT_FOUND);
    let body: Value = owner.json().await.expect("json");
    assert_eq!(body["code"], "archived");
    assert_eq!(
        alice.get(&texts_of(shared.project)).await.status(),
        StatusCode::NOT_FOUND
    );
}

fn output_of(project: impl std::fmt::Display, kind: &str) -> String {
    format!("/web/api/projects/{project}/output/{kind}")
}

async fn upload(
    browser: &Browser,
    path: &str,
    main: Option<&str>,
    bytes: Vec<u8>,
) -> reqwest::Response {
    let headers: Vec<(&str, &str)> = main
        .map(|main| (MAIN_FILE_HEADER, main))
        .into_iter()
        .collect();
    browser
        .put(path, Some(&browser.base), true, &headers, bytes)
        .await
}

#[tokio::test]
async fn an_editor_in_the_browser_stores_a_pdf_and_its_synctex_and_open_browsers_hear_of_it() {
    let stage = web_stage().await;
    let shared = share_doc_project(&stage, ProjectRole::Editor).await;
    let alice = browser_sign_in(&stage.server, "github2", "/web/").await;
    let bob = browser_sign_in(&stage.server, "github", "/web/").await;
    let mut watching = web_socket(&stage.server, &bob, shared.project).await;
    assert_eq!(until(&mut watching, "output").await["items"], json!([]));
    let pdf = b"%PDF-1.7\nfrom the browser".to_vec();
    let stored = upload(
        &alice,
        &output_of(shared.project, "pdf"),
        Some("chapters/one%20two.tex"),
        pdf.clone(),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    assert_eq!(header(&stored, "cache-control"), "no-store");
    let body: Value = stored.json().await.expect("json");
    assert_eq!(body["kind"], "pdf");
    assert_eq!(body["size"], pdf.len());
    assert_eq!(body["mainFile"], "chapters/one two.tex");
    assert_eq!(
        body["compiledBy"],
        Value::String(stage.alice.tokens.account_id.to_string())
    );
    assert!(body["compiledAt"].as_i64().is_some());
    let heard = until(&mut watching, "output").await;
    assert_eq!(heard["items"], json!([body]));
    let synctex = vec![0x1f, 0x8b, 8, 0, 1, 2, 3, 4];
    let stored = upload(
        &alice,
        &output_of(shared.project, "synctex"),
        Some("main.tex"),
        synctex.clone(),
    )
    .await;
    assert_eq!(stored.status(), StatusCode::OK);
    let heard = until(&mut watching, "output").await;
    let kinds: Vec<&str> = heard["items"]
        .as_array()
        .expect("items")
        .iter()
        .filter_map(|item| item["kind"].as_str())
        .collect();
    assert_eq!(kinds, ["pdf", "synctex"]);
    let served = bob.get(&output_of(shared.project, "pdf")).await;
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(served.bytes().await.expect("bytes").to_vec(), pdf);
    let served = bob.get(&output_of(shared.project, "synctex")).await;
    assert_eq!(header(&served, "content-type"), "application/gzip");
    assert_eq!(served.bytes().await.expect("bytes").to_vec(), synctex);
}

#[tokio::test]
async fn the_browser_upload_keeps_the_app_routes_rules_and_needs_the_app_marker() {
    let mut config = web_config();
    config.limits.max_file_mb = 1;
    let stage = people::stage_with(config).await;
    let shared = share_doc_project(&stage, ProjectRole::Viewer).await;
    let alice = browser_sign_in(&stage.server, "github2", "/web/").await;
    let pdf = || b"%PDF-1.7\nx".to_vec();
    let path = output_of(shared.project, "pdf");
    for role in [
        ProjectRole::Viewer,
        ProjectRole::Reviewer,
        ProjectRole::Commenter,
    ] {
        if role != ProjectRole::Viewer {
            let granted = grant(
                &stage.server,
                &stage.bob,
                shared.project,
                &stage.alice,
                role,
            )
            .await;
            assert_eq!(granted.status(), StatusCode::OK);
        }
        let refused = upload(&alice, &path, Some("main.tex"), pdf()).await;
        assert_eq!(refused.status(), StatusCode::FORBIDDEN, "{role:?}");
        let body: Value = refused.json().await.expect("json");
        assert_eq!(body["code"], "forbidden", "{role:?}");
    }
    let bob = browser_sign_in(&stage.server, "github", "/web/").await;
    let named = [(MAIN_FILE_HEADER, "main.tex")];
    for (origin, marked) in [
        (Some(bob.base.as_str()), false),
        (None, true),
        (Some("https://evil.example"), true),
    ] {
        let refused = bob.put(&path, origin, marked, &named, pdf()).await;
        assert_eq!(
            refused.status(),
            StatusCode::FORBIDDEN,
            "{origin:?} {marked}"
        );
        let body: Value = refused.json().await.expect("json");
        assert_eq!(body["code"], "cross_site", "{origin:?} {marked}");
    }
    let anonymous = reqwest::Client::new()
        .put(format!("{}{path}", stage.server.url()))
        .header("origin", stage.server.url())
        .header("x-requested-with", "oleafly-web")
        .header(MAIN_FILE_HEADER, "main.tex")
        .body(pdf())
        .send()
        .await
        .expect("request");
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    let mut too_large = pdf();
    too_large.resize(2 * 1024 * 1024, b' ');
    for (kind, main, bytes) in [
        ("pdf", None, pdf()),
        ("pdf", Some("main.tex"), b"<html>not a pdf</html>".to_vec()),
        ("synctex", Some("main.tex"), b"SyncTeX Version:1\n".to_vec()),
        ("pdf", Some("main.tex"), too_large),
        ("html", Some("main.tex"), pdf()),
    ] {
        let size = bytes.len();
        let refused = upload(&bob, &output_of(shared.project, kind), main, bytes).await;
        assert_eq!(
            refused.status(),
            StatusCode::BAD_REQUEST,
            "{kind} {main:?} {size}"
        );
    }
    let listed = bob
        .json(&format!("/web/api/projects/{}/output", shared.project))
        .await;
    assert_eq!(listed["items"], json!([]));
    let archived = call(
        &stage.server,
        Method::POST,
        &format!("/api/v1/projects/{}/archive", shared.project),
        stage.bob.token(),
        None,
    )
    .await;
    assert_eq!(archived.status(), StatusCode::NO_CONTENT);
    let refused = upload(&bob, &path, Some("main.tex"), pdf()).await;
    assert_eq!(refused.status(), StatusCode::CONFLICT);
}
