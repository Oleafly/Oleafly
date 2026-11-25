use std::sync::Arc;

use super::{create_project, CREATE_LIMIT_BYTES, CREATE_ROUTE};
use crate::client::Http;
use crate::live::rest::{ProjectRest, RestError};
use crate::realtime::ProjectPage;
use crate::session::{Session, SessionHandle};
use crate::test_support::mock_overleaf::{Fault, MockOverleaf, MockProject, MockUser, MOCK_CSRF};
use crate::test_support::overleaf_rt::probe_step;
use crate::test_support::zip_bytes;

fn http(mock: &MockOverleaf) -> Http {
    Http::new(&mock.base, "Oleafly/test").unwrap()
}

fn archive() -> Vec<u8> {
    zip_bytes(&[
        (
            "main.tex",
            "\\documentclass{article}\n\\title{Uploaded From Oleafly}\n\\begin{document}\\end{document}\n",
        ),
        ("notes.tex", "notes"),
        ("main.bbl", "built"),
        ("figures/pixel.png", "\u{0}png"),
    ])
}

async fn start() -> (MockOverleaf, MockUser) {
    let mock = MockOverleaf::start(MockProject::new("Existing").doc("old.tex", "old")).await;
    let alice = mock.user("alice");
    (mock, alice)
}

#[tokio::test]
async fn a_new_project_is_created_from_one_upload_named_by_its_title() {
    let (mock, alice) = start().await;
    let id = create_project(
        &http(&mock),
        &alice.cookie(),
        MOCK_CSRF,
        "my-archive",
        archive(),
    )
    .await
    .unwrap();
    assert_eq!(id, mock.project_id());
    assert_eq!(mock.project_name(), "Uploaded From Oleafly");
    assert_eq!(mock.root_doc_path().as_deref(), Some("main.tex"));
    let created = mock.created();
    assert_eq!(created.len(), 1);
    assert_eq!(
        created[0].entries,
        ["figures/pixel.png", "main.tex", "notes.tex"]
    );
    let sent = mock.requests(CREATE_ROUTE);
    assert_eq!(sent.len(), 1);
    assert!(sent[0]
        .body
        .contains("name=\"qqfile\"; filename=\"my-archive.zip\""));
}

#[tokio::test]
async fn refusals_are_told_apart_and_nothing_is_sent_twice() {
    let (mock, alice) = start().await;
    let client = http(&mock);
    let cookie = alice.cookie();
    let refused = create_project(&client, &cookie, MOCK_CSRF, "bad", b"not a zip".to_vec()).await;
    assert_eq!(
        refused,
        Err(RestError::Refused {
            status: 422,
            message: "Invalid zip file".into()
        })
    );
    for (status, body, expected) in [
        (
            400,
            r#"{"success":false,"error":"invalid_upload_request"}"#,
            RestError::Refused {
                status: 400,
                message: "invalid_upload_request".into(),
            },
        ),
        (
            429,
            "Rate limit reached, please try again later",
            RestError::RateLimited(None),
        ),
        (
            500,
            "{\"success\":false,\"error\":\"upload_failed\"}",
            RestError::ServerFailed {
                status: 500,
                message: "upload_failed".into(),
            },
        ),
        (
            502,
            "<html><body>Bad gateway</body></html>",
            RestError::ServerFailed {
                status: 502,
                message: String::new(),
            },
        ),
    ] {
        mock.plan_fault(
            Some("POST"),
            CREATE_ROUTE,
            Fault::Reply(status, body.to_string()),
        );
        let answer = create_project(&client, &cookie, MOCK_CSRF, "x", archive()).await;
        assert_eq!(answer, Err(expected), "{status}");
    }
    let signed_out =
        create_project(&client, "overleaf.sid=nobody", MOCK_CSRF, "x", archive()).await;
    assert_eq!(signed_out, Err(RestError::SignedOut));
    assert_eq!(mock.requests(CREATE_ROUTE).len(), 6);
    assert!(mock.created().is_empty());
}

#[tokio::test]
async fn a_lost_reply_is_not_sent_again_and_a_large_project_is_never_sent() {
    let (mock, alice) = start().await;
    let client = http(&mock);
    mock.plan_fault(Some("POST"), CREATE_ROUTE, Fault::LoseReply);
    let lost = create_project(&client, &alice.cookie(), MOCK_CSRF, "x", archive()).await;
    assert!(matches!(lost, Err(RestError::Lost(_))), "{lost:?}");
    assert_eq!(mock.requests(CREATE_ROUTE).len(), 1);
    assert_eq!(mock.created().len(), 1);

    let large = vec![0_u8; CREATE_LIMIT_BYTES as usize + 1];
    let refused = create_project(&client, &alice.cookie(), MOCK_CSRF, "x", large).await;
    assert_eq!(refused, Err(RestError::TooLarge));
    assert_eq!(mock.requests(CREATE_ROUTE).len(), 1);
}

#[tokio::test]
async fn the_owner_renames_the_new_project() {
    let (mock, alice) = start().await;
    let client = http(&mock);
    let session = SessionHandle::new(
        &mock.base,
        Session {
            cookie: alice.cookie(),
            user_id: alice.id.clone(),
            email: alice.email.clone(),
            saved_by: None,
        },
        None,
    );
    let page = Arc::new(ProjectPage::unloaded(&mock.project_id()).unwrap());
    let rest = ProjectRest::new(client, page, &mock.project_id());
    rest.rename_project(&session, "Local name").await.unwrap();
    assert_eq!(mock.project_name(), "Local name");
}

#[tokio::test]
async fn uploads_become_projects_and_meet_the_limit_like_ce() {
    const CE: &str = "project-upload-create";
    let (mock, alice) = start().await;
    let client = http(&mock);
    let cookie = alice.cookie();
    let pixel: &[u8] = b"\x89PNG\r\n\x1a\npixel";
    let titled: Vec<(&str, &[u8])> = vec![
        (
            "main.tex",
            b"\\documentclass{article}\n\\title{Uploaded From Oleafly}\n",
        ),
        ("refs.bib", b"@book{a,}"),
        ("sections/intro.tex", b"Intro"),
        ("figures/pixel.png", pixel),
        ("main.aux", b"built"),
        (".DS_Store", b"finder"),
        ("__MACOSX/._main.tex", b"fork"),
    ];
    let untitled: Vec<(&str, &[u8])> = vec![
        ("notes.tex", b"Notes"),
        ("paper.tex", b"\\documentclass{article}\n"),
    ];
    let wrapped: Vec<(&str, &[u8])> = vec![
        ("repo-main/main.tex", b"\\documentclass{article}\n"),
        ("repo-main/img/pixel.png", pixel),
    ];
    let readme: Vec<(&str, &[u8])> = vec![("readme.md", b"Read me")];
    for (label, sent, files) in [
        ("titled", "a titled project with ignored files", &titled),
        (
            "untitled",
            "no \\title, the root is the doc with \\documentclass",
            &untitled,
        ),
        ("same name", "the same name again", &untitled),
        ("wrapped", "a single top-level folder", &wrapped),
        ("no tex", "no tex file at all", &readme),
    ] {
        let ce = probe_step(CE, sent);
        let name = ce["request"]["upload"]["name"].as_str().unwrap();
        let id = create_project(
            &client,
            &cookie,
            MOCK_CSRF,
            name.strip_suffix(".zip").unwrap(),
            zip_bytes(files),
        )
        .await
        .unwrap();
        assert_eq!(ce["status"], 200, "{label}");
        let created = probe_step(CE, &format!("{label}: the created project"))["created"].clone();
        assert_eq!(mock.project_name(), created["name"], "{label}");
        assert_eq!(
            serde_json::json!(mock.root_doc_path()),
            created["rootDoc"],
            "{label}"
        );
        assert_eq!(mock.compiler(), created["compiler"], "{label}");
        let listed: serde_json::Value = reqwest::Client::new()
            .get(format!("{}/project/{id}/entities", mock.base))
            .header("Cookie", &cookie)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let sorted = |entities: &serde_json::Value| {
            let mut entities = entities.as_array().unwrap().clone();
            entities.sort_by_key(|entity| entity["path"].as_str().unwrap().to_string());
            entities
        };
        assert_eq!(
            sorted(&listed["entities"]),
            sorted(&created["entities"]),
            "{label}"
        );
    }
    let empty: Vec<(&str, &[u8])> = Vec::new();
    for (label, bytes) in [
        ("not a zip", b"not a zip".to_vec()),
        ("an empty zip", zip_bytes(&empty)),
    ] {
        let ce = probe_step(CE, label);
        let refused = create_project(&client, &cookie, MOCK_CSRF, "garbage", bytes).await;
        assert_eq!(
            refused,
            Err(RestError::Refused {
                status: ce["status"].as_u64().unwrap() as u16,
                message: ce["body"]["error"].as_str().unwrap().into(),
            }),
            "{label}"
        );
    }
    let ce = probe_step(CE, "no file");
    let reply = reqwest::Client::new()
        .post(format!("{}{CREATE_ROUTE}", mock.base))
        .header("Cookie", &cookie)
        .header("X-Csrf-Token", MOCK_CSRF)
        .header("Content-Type", "multipart/form-data; boundary=XyZ")
        .body("--XyZ--\r\n")
        .send()
        .await
        .unwrap();
    assert_eq!(reply.status().as_u16(), ce["status"]);
    assert_eq!(reply.json::<serde_json::Value>().await.unwrap(), ce["body"]);
    let ce_refused_at = (1..)
        .map(|attempt| probe_step(CE, &format!("invalid upload {attempt} for the rate limit")))
        .position(|step| step["status"] == 429)
        .unwrap();
    let mut attempts = 0;
    loop {
        let answer = create_project(&client, &cookie, MOCK_CSRF, "garbage", b"junk".to_vec()).await;
        if answer == Err(RestError::RateLimited(None)) {
            break;
        }
        attempts += 1;
        assert!(attempts <= 40, "{answer:?}");
    }
    assert_eq!(attempts, ce_refused_at);
}
