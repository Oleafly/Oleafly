mod support;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::outputs::{
    OutputKind, ProjectOutput, FOR_PDF_HEADER, MAIN_FILE_HEADER,
};
use oleafly_collab_protocol::projects::{ProjectRole, ProjectStatus};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::blobs::sha256_hex;
use oleafly_server::clock::Clock;
use oleafly_server::projects::{self, Removal};
use oleafly_server::test_support::{
    seed_member, test_app_with, test_config, SeededMember, TestApp,
};
use serde_json::Value;
use tower::ServiceExt;

struct Answer {
    status: StatusCode,
    headers: HeaderMap,
    bytes: Vec<u8>,
}

impl Answer {
    fn json(&self) -> Value {
        serde_json::from_slice(&self.bytes).unwrap_or(Value::Null)
    }

    fn code(&self) -> String {
        self.json()["code"].as_str().unwrap_or_default().to_owned()
    }
}

async fn ask(app: &TestApp, request: Request<Body>) -> Answer {
    let response = app.router.clone().oneshot(request).await.expect("response");
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = axum::body::to_bytes(response.into_body(), 64 * 1024 * 1024)
        .await
        .expect("body")
        .to_vec();
    Answer {
        status,
        headers,
        bytes,
    }
}

async fn put_output(
    app: &TestApp,
    project: SharedProjectId,
    kind: &str,
    token: &str,
    bytes: Vec<u8>,
    main_file: Option<&str>,
) -> Answer {
    let mut builder = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/projects/{project}/output/{kind}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_LENGTH, bytes.len());
    if let Some(main) = main_file {
        builder = builder.header(MAIN_FILE_HEADER, main);
    }
    ask(app, builder.body(Body::from(bytes)).expect("request")).await
}

async fn put_synctex_for(
    app: &TestApp,
    project: SharedProjectId,
    token: &str,
    bytes: Vec<u8>,
    pdf_hash: &str,
) -> Answer {
    let request = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/projects/{project}/output/synctex"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .header(header::CONTENT_LENGTH, bytes.len())
        .header(MAIN_FILE_HEADER, "main.tex")
        .header(FOR_PDF_HEADER, pdf_hash)
        .body(Body::from(bytes))
        .expect("request");
    ask(app, request).await
}

async fn kinds(app: &TestApp, project: SharedProjectId, token: &str) -> Vec<OutputKind> {
    let listed: Vec<ProjectOutput> = serde_json::from_slice(
        &get(app, &format!("/api/v1/projects/{project}/output"), token)
            .await
            .bytes,
    )
    .expect("list");
    listed.iter().map(|output| output.kind).collect()
}

async fn get(app: &TestApp, path: &str, token: &str) -> Answer {
    let request = Request::builder()
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .expect("request");
    ask(app, request).await
}

fn pdf(size: usize) -> Vec<u8> {
    let salt = oleafly_server::tokens::random_token();
    let mut bytes = b"%PDF-1.7\n".to_vec();
    bytes.extend_from_slice(salt.as_bytes());
    bytes.extend((0..size).map(|at| (at % 241) as u8));
    bytes
}

fn synctex(size: usize) -> Vec<u8> {
    let salt = oleafly_server::tokens::random_token();
    let mut bytes = vec![0x1f, 0x8b, 8, 0];
    bytes.extend_from_slice(salt.as_bytes());
    bytes.extend((0..size).map(|at| (at % 239) as u8));
    bytes
}

struct People {
    app: TestApp,
    owner: SeededMember,
    editor: SeededMember,
    viewer: SeededMember,
    outsider: SeededMember,
    project: SharedProjectId,
}

async fn people() -> People {
    let mut config = test_config();
    config.limits.max_file_mb = 2;
    let app = test_app_with(config).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let editor = seed_member(&app, ServerRole::Member).await;
    let viewer = seed_member(&app, ServerRole::Member).await;
    let outsider = seed_member(&app, ServerRole::Member).await;
    let now = app.clock.now_ms();
    let (owner_id, editor_id, viewer_id) = (owner.account_id, editor.account_id, viewer.account_id);
    let project = app
        .state
        .db
        .call(move |conn| {
            let project = projects::create_pending(conn, owner_id, "Thesis", now)?;
            projects::set_status(conn, project, ProjectStatus::Active, now)?;
            projects::grant(conn, project, editor_id, ProjectRole::Editor, owner_id, now)?;
            projects::grant(conn, project, viewer_id, ProjectRole::Viewer, owner_id, now)?;
            Ok(project)
        })
        .await
        .expect("a project");
    People {
        app,
        owner,
        editor,
        viewer,
        outsider,
        project,
    }
}

async fn held(app: &TestApp, hash: &str) -> bool {
    app.state.blobs.open(hash).await.expect("open").is_some()
}

async fn pending(app: &TestApp) -> Vec<String> {
    app.state
        .db
        .call(|conn| projects::pending_removals(conn, 100))
        .await
        .expect("pending removals")
        .into_iter()
        .filter(|removal| removal.kind == Removal::File)
        .map(|removal| removal.hash)
        .collect()
}

#[tokio::test]
async fn an_editor_puts_the_pdf_and_every_member_reads_it() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let empty = get(
        app,
        &format!("/api/v1/projects/{project}/output"),
        &people.viewer.access_token,
    )
    .await;
    assert_eq!(empty.status, StatusCode::OK);
    assert_eq!(empty.json(), Value::Array(Vec::new()));
    let bytes = pdf(600 * 1024);
    let stored = put_output(
        app,
        project,
        "pdf",
        &people.editor.access_token,
        bytes.clone(),
        Some("chapters/main%20file.tex"),
    )
    .await;
    assert_eq!(stored.status, StatusCode::OK, "{:?}", stored.json());
    let meta: ProjectOutput = serde_json::from_slice(&stored.bytes).expect("meta");
    assert_eq!(meta.kind, OutputKind::Pdf);
    assert_eq!(meta.size, bytes.len() as u64);
    assert_eq!(meta.compiled_by, people.editor.account_id);
    assert_eq!(meta.compiled_at, app.clock.now_ms());
    assert_eq!(meta.main_file, "chapters/main file.tex");
    for reader in [&people.owner, &people.editor, &people.viewer] {
        let listed = get(
            app,
            &format!("/api/v1/projects/{project}/output"),
            &reader.access_token,
        )
        .await;
        let listed: Vec<ProjectOutput> = serde_json::from_slice(&listed.bytes).expect("list");
        assert_eq!(listed, std::slice::from_ref(&meta));
        let fetched = get(
            app,
            &format!("/api/v1/projects/{project}/output/pdf"),
            &reader.access_token,
        )
        .await;
        assert_eq!(fetched.status, StatusCode::OK);
        assert_eq!(fetched.bytes, bytes);
        assert_eq!(fetched.headers[header::CONTENT_TYPE], "application/pdf");
        assert_eq!(
            fetched.headers[MAIN_FILE_HEADER],
            "chapters/main%20file.tex"
        );
        assert_eq!(
            fetched.headers[header::ETAG],
            format!("\"{}\"", sha256_hex(&bytes)).as_str()
        );
    }
    let missing = get(
        app,
        &format!("/api/v1/projects/{project}/output/synctex"),
        &people.viewer.access_token,
    )
    .await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn viewers_and_outsiders_cannot_put_and_outsiders_cannot_read() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let viewer = put_output(
        app,
        project,
        "pdf",
        &people.viewer.access_token,
        pdf(100),
        Some("main.tex"),
    )
    .await;
    assert_eq!(viewer.status, StatusCode::FORBIDDEN);
    let outsider = put_output(
        app,
        project,
        "pdf",
        &people.outsider.access_token,
        pdf(100),
        Some("main.tex"),
    )
    .await;
    assert_eq!(outsider.status, StatusCode::NOT_FOUND);
    put_output(
        app,
        project,
        "pdf",
        &people.owner.access_token,
        pdf(100),
        Some("main.tex"),
    )
    .await;
    for path in [
        format!("/api/v1/projects/{project}/output"),
        format!("/api/v1/projects/{project}/output/pdf"),
    ] {
        let read = get(app, &path, &people.outsider.access_token).await;
        assert_eq!(read.status, StatusCode::NOT_FOUND, "{path}");
    }
}

#[tokio::test]
async fn a_new_output_replaces_the_old_one_and_its_file_is_removed() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let first = pdf(4000);
    let second = pdf(5000);
    let (old, new) = (sha256_hex(&first), sha256_hex(&second));
    let token = &people.owner.access_token;
    put_output(app, project, "pdf", token, first, Some("main.tex")).await;
    assert!(held(app, &old).await);
    app.clock.advance(5_000);
    let replaced = put_output(
        app,
        project,
        "pdf",
        token,
        second.clone(),
        Some("other.tex"),
    )
    .await;
    assert_eq!(replaced.status, StatusCode::OK);
    assert!(!held(app, &old).await, "the replaced pdf is removed");
    assert!(held(app, &new).await);
    assert!(!pending(app).await.contains(&old));
    let fetched = get(
        app,
        &format!("/api/v1/projects/{project}/output/pdf"),
        token,
    )
    .await;
    assert_eq!(fetched.bytes, second);
    let listed: Vec<ProjectOutput> = serde_json::from_slice(
        &get(app, &format!("/api/v1/projects/{project}/output"), token)
            .await
            .bytes,
    )
    .expect("list");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].main_file, "other.tex");
    assert_eq!(listed[0].compiled_at, app.clock.now_ms());
}

#[tokio::test]
async fn a_replaced_output_whose_file_a_project_also_holds_keeps_that_file() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.owner.access_token;
    let shared_bytes = pdf(3000);
    let hash = sha256_hex(&shared_bytes);
    let blob = Request::builder()
        .method(Method::PUT)
        .uri(format!("/api/v1/projects/{project}/blobs/{hash}"))
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::from(shared_bytes.clone()))
        .expect("request");
    assert_eq!(ask(app, blob).await.status, StatusCode::NO_CONTENT);
    put_output(app, project, "pdf", token, shared_bytes, Some("main.tex")).await;
    put_output(app, project, "pdf", token, pdf(3100), Some("main.tex")).await;
    assert!(held(app, &hash).await, "the project's own file stays");
    let fetched = get(
        app,
        &format!("/api/v1/projects/{project}/blobs/{hash}"),
        token,
    )
    .await;
    assert_eq!(fetched.status, StatusCode::OK);
}

#[tokio::test]
async fn a_new_pdf_takes_the_old_synctex_with_it() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.editor.access_token;
    let old_sync = synctex(2000);
    let old_hash = sha256_hex(&old_sync);
    put_output(app, project, "pdf", token, pdf(2000), Some("main.tex")).await;
    put_output(app, project, "synctex", token, old_sync, Some("main.tex")).await;
    assert_eq!(
        kinds(app, project, token).await,
        [OutputKind::Pdf, OutputKind::Synctex]
    );
    let newer = put_output(app, project, "pdf", token, pdf(2100), Some("main.tex")).await;
    assert_eq!(newer.status, StatusCode::OK);
    assert_eq!(kinds(app, project, token).await, [OutputKind::Pdf]);
    assert!(!held(app, &old_hash).await, "the old synctex is removed");
    let missing = get(
        app,
        &format!("/api/v1/projects/{project}/output/synctex"),
        token,
    )
    .await;
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn a_synctex_naming_a_pdf_that_was_replaced_is_refused() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.editor.access_token;
    let first = pdf(2000);
    let second = pdf(2200);
    let (first_hash, second_hash) = (sha256_hex(&first), sha256_hex(&second));
    put_output(app, project, "pdf", token, first, Some("main.tex")).await;
    put_output(app, project, "pdf", token, second.clone(), Some("main.tex")).await;
    let late = synctex(1500);
    let late_hash = sha256_hex(&late);
    let refused = put_synctex_for(app, project, token, late, &first_hash).await;
    assert_eq!(refused.status, StatusCode::CONFLICT, "{:?}", refused.json());
    assert_eq!(refused.code(), "conflict");
    assert!(
        pending(app).await.contains(&late_hash),
        "the refused synctex is queued for removal"
    );
    assert_eq!(kinds(app, project, token).await, [OutputKind::Pdf]);
    let paired = put_synctex_for(app, project, token, synctex(1500), &second_hash).await;
    assert_eq!(paired.status, StatusCode::OK, "{:?}", paired.json());
    assert_eq!(
        kinds(app, project, token).await,
        [OutputKind::Pdf, OutputKind::Synctex]
    );
    let fetched = get(
        app,
        &format!("/api/v1/projects/{project}/output/pdf"),
        token,
    )
    .await;
    assert_eq!(fetched.bytes, second);
}

#[tokio::test]
async fn pdf_and_synctex_are_kept_apart() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.editor.access_token;
    let sync = synctex(2000);
    put_output(app, project, "pdf", token, pdf(2000), Some("main.tex")).await;
    let stored = put_output(
        app,
        project,
        "synctex",
        token,
        sync.clone(),
        Some("main.tex"),
    )
    .await;
    assert_eq!(stored.status, StatusCode::OK, "{:?}", stored.json());
    let listed: Vec<ProjectOutput> = serde_json::from_slice(
        &get(app, &format!("/api/v1/projects/{project}/output"), token)
            .await
            .bytes,
    )
    .expect("list");
    let kinds: Vec<OutputKind> = listed.iter().map(|output| output.kind).collect();
    assert_eq!(kinds, [OutputKind::Pdf, OutputKind::Synctex]);
    let fetched = get(
        app,
        &format!("/api/v1/projects/{project}/output/synctex"),
        token,
    )
    .await;
    assert_eq!(fetched.bytes, sync);
    assert_eq!(fetched.headers[header::CONTENT_TYPE], "application/gzip");
}

#[tokio::test]
async fn outputs_that_are_not_what_they_say_or_too_large_are_refused() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.owner.access_token;
    let cases = [
        ("pdf", b"<html>not a pdf</html>".to_vec(), Some("main.tex")),
        ("synctex", b"SyncTeX Version:1\n".to_vec(), Some("main.tex")),
        ("html", pdf(10), Some("main.tex")),
        ("pdf", pdf(10), None),
        ("pdf", pdf(10), Some("bad%2")),
        ("pdf", pdf(3 * 1024 * 1024), Some("main.tex")),
        ("pdf", Vec::new(), Some("main.tex")),
    ];
    for (kind, bytes, main) in cases {
        let size = bytes.len();
        let refused = put_output(app, project, kind, token, bytes, main).await;
        assert_eq!(
            refused.status,
            StatusCode::BAD_REQUEST,
            "{kind} {size} {main:?}: {:?}",
            refused.json()
        );
    }
    let listed = get(app, &format!("/api/v1/projects/{project}/output"), token).await;
    assert_eq!(listed.json(), Value::Array(Vec::new()));
}

#[tokio::test]
async fn an_archived_project_takes_no_new_output_but_its_owner_still_reads_the_last() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.owner.access_token;
    let bytes = pdf(1000);
    put_output(app, project, "pdf", token, bytes.clone(), Some("main.tex")).await;
    let now = app.clock.now_ms();
    app.state
        .db
        .call(move |conn| projects::set_status(conn, project, ProjectStatus::Archived, now))
        .await
        .expect("archived");
    let refused = put_output(app, project, "pdf", token, pdf(1000), Some("main.tex")).await;
    assert_eq!(refused.status, StatusCode::CONFLICT);
    let fetched = get(
        app,
        &format!("/api/v1/projects/{project}/output/pdf"),
        token,
    )
    .await;
    assert_eq!(fetched.bytes, bytes);
    assert_eq!(refused.code(), "conflict");
}

#[tokio::test]
async fn deleting_a_project_queues_its_output_files_for_removal() {
    let people = people().await;
    let (app, project) = (&people.app, people.project);
    let token = &people.owner.access_token;
    let bytes = pdf(1000);
    let hash = sha256_hex(&bytes);
    put_output(app, project, "pdf", token, bytes, Some("main.tex")).await;
    let now = app.clock.now_ms();
    let deleted = app
        .state
        .db
        .call(move |conn| projects::delete_project(conn, project, now))
        .await
        .expect("deleted");
    assert!(deleted.orphan_blobs.contains(&hash));
    assert!(pending(app).await.contains(&hash));
    let left: i64 = app
        .state
        .db
        .call(|conn| {
            Ok(conn.query_row("SELECT COUNT(*) FROM project_outputs", [], |row| row.get(0))?)
        })
        .await
        .expect("count");
    assert_eq!(left, 0);
}

#[tokio::test]
async fn the_owner_of_a_pending_project_may_store_an_output_before_sharing() {
    let app = test_app_with(test_config()).await;
    let owner = seed_member(&app, ServerRole::Member).await;
    let (owner_id, now): (AccountId, i64) = (owner.account_id, app.clock.now_ms());
    let project = app
        .state
        .db
        .call(move |conn| projects::create_pending(conn, owner_id, "Draft", now))
        .await
        .expect("pending");
    let stored = put_output(
        &app,
        project,
        "pdf",
        &owner.access_token,
        pdf(10),
        Some("main.tex"),
    )
    .await;
    assert_eq!(stored.status, StatusCode::OK);
}
