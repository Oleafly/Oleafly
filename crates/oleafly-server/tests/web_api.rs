#![cfg(feature = "web")]

mod people;
mod web_support;

use oleafly_collab_protocol::outputs::MAIN_FILE_HEADER;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_server::blobs::sha256_hex;
use people::put_bytes;
use reqwest::header::{CONTENT_TYPE, LOCATION};
use reqwest::StatusCode;
use serde_json::Value;
use web_support::{browser_sign_in, share_doc_project, web_stage};

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
