use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use oleafly_collab_protocol::admin::RuntimeSettingsPatch;
use oleafly_collab_protocol::published::{PublishedNote, PublishedNotes};
use oleafly_collab_protocol::roles::ServerRole;
use oleafly_server::config::AccountQuotas;
use oleafly_server::published::{PAGE_BURST, PUBLISH_BURST};
use oleafly_server::settings;
use oleafly_server::test_support::{
    seed_member, test_app, test_app_with, test_config, SeededMember, TestApp, TEST_PUBLIC_URL,
};
use serde_json::{json, Value};
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

    fn text(&self) -> String {
        String::from_utf8_lossy(&self.bytes).into_owned()
    }

    fn header(&self, name: header::HeaderName) -> String {
        self.headers
            .get(name)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned()
    }

    fn note(&self) -> PublishedNote {
        serde_json::from_slice(&self.bytes).expect("a published note")
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

async fn publish(
    app: &TestApp,
    who: &SeededMember,
    source: &str,
    title: &str,
    html: &str,
) -> Answer {
    let body = serde_json::to_vec(&json!({ "source": source, "title": title, "html": html }))
        .expect("json");
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/v1/published-notes")
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", who.access_token),
        )
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CONTENT_LENGTH, body.len())
        .body(Body::from(body))
        .expect("request");
    ask(app, request).await
}

async fn listed(app: &TestApp, who: &SeededMember) -> PublishedNotes {
    let request = Request::builder()
        .uri("/api/v1/published-notes")
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", who.access_token),
        )
        .body(Body::empty())
        .expect("request");
    serde_json::from_slice(&ask(app, request).await.bytes).expect("a list")
}

async fn unpublish(app: &TestApp, who: &SeededMember, id: &str) -> Answer {
    let request = Request::builder()
        .method(Method::DELETE)
        .uri(format!("/api/v1/published-notes/{id}"))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", who.access_token),
        )
        .body(Body::empty())
        .expect("request");
    ask(app, request).await
}

async fn visit(app: &TestApp, url: &str, etag: Option<&str>) -> Answer {
    let path = url.strip_prefix(TEST_PUBLIC_URL).unwrap_or(url);
    let mut builder = Request::builder().uri(path);
    if let Some(etag) = etag {
        builder = builder.header(header::IF_NONE_MATCH, etag);
    }
    ask(app, builder.body(Body::empty()).expect("request")).await
}

async fn allow_public_notes(app: &TestApp, allowed: bool) {
    app.state
        .db
        .call(move |conn| {
            settings::patch(
                conn,
                &RuntimeSettingsPatch {
                    public_notes_allowed: Some(allowed),
                    ..RuntimeSettingsPatch::default()
                },
            )
        })
        .await
        .expect("settings saved");
}

#[tokio::test]
async fn publishing_waits_for_the_admin_switch_and_the_page_is_served_sandboxed() {
    let app = test_app().await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let refused = publish(&app, &ada, "note-1", "Reading list", "<p>Hi</p>").await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "public_notes_off");
    assert!(!listed(&app, &ada).await.allowed);

    allow_public_notes(&app, true).await;
    assert!(listed(&app, &ada).await.allowed);
    let published = publish(
        &app,
        &ada,
        "note-1",
        "Reading <list>",
        "<h2>Papers</h2><p onclick=\"steal()\">One<script>steal()</script></p><img src=\"https://tracker.example/p.gif\" alt=\"p\">",
    )
    .await;
    assert_eq!(published.status, StatusCode::OK, "{}", published.text());
    let note = published.note();
    assert_eq!(note.title, "Reading <list>");
    assert_eq!(note.source, "note-1");
    let slug = note
        .url
        .strip_prefix(&format!("{TEST_PUBLIC_URL}/n/"))
        .expect("a public URL on this server");
    assert_eq!(slug.len(), 16);

    let page = visit(&app, &note.url, None).await;
    assert_eq!(page.status, StatusCode::OK);
    assert_eq!(
        page.header(header::CONTENT_TYPE),
        "text/html; charset=utf-8"
    );
    let policy = page.header(header::CONTENT_SECURITY_POLICY);
    assert!(policy.starts_with("sandbox;"), "{policy}");
    assert!(policy.contains("default-src 'none'"));
    assert_eq!(page.header(header::X_CONTENT_TYPE_OPTIONS), "nosniff");
    assert_eq!(page.header(header::REFERRER_POLICY), "no-referrer");
    assert_eq!(page.header(header::X_FRAME_OPTIONS), "DENY");
    assert_eq!(page.header(header::CACHE_CONTROL), "no-cache");
    assert_eq!(
        page.header(header::HeaderName::from_static("x-robots-tag")),
        "noindex, nofollow"
    );
    let html = page.text();
    assert!(html.contains("<h1>Reading &lt;list&gt;</h1>"));
    assert!(html.contains("<h2>Papers</h2><p>One</p>"));
    assert!(!html.contains("steal"));
    assert!(!html.contains("tracker"));

    allow_public_notes(&app, false).await;
    let hidden = visit(&app, &note.url, None).await;
    assert_eq!(hidden.status, StatusCode::NOT_FOUND);
    assert!(
        hidden.text().contains("This page isn&#39;t available")
            || hidden.text().contains("This page isn't available")
    );
    assert_eq!(
        hidden.header(header::HeaderName::from_static("x-robots-tag")),
        "noindex, nofollow"
    );
    let listing = listed(&app, &ada).await;
    assert!(!listing.allowed);
    assert_eq!(listing.notes.len(), 1);
}

#[tokio::test]
async fn republishing_keeps_the_link_and_changes_what_readers_see() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let first = publish(&app, &ada, "note-1", "Draft", "<p>First</p>")
        .await
        .note();
    let page = visit(&app, &first.url, None).await;
    let etag = page.header(header::ETAG);
    assert!(etag.starts_with('"'));
    let again = visit(&app, &first.url, Some(&etag)).await;
    assert_eq!(again.status, StatusCode::NOT_MODIFIED);
    assert!(again.bytes.is_empty());

    app.clock.advance(60_000);
    let second = publish(&app, &ada, "note-1", "Final", "<p>Second</p>")
        .await
        .note();
    assert_eq!(second.id, first.id);
    assert_eq!(second.url, first.url);
    assert_eq!(second.published_at, first.published_at);
    assert!(second.updated_at > first.updated_at);
    let fresh = visit(&app, &first.url, Some(&etag)).await;
    assert_eq!(fresh.status, StatusCode::OK);
    assert!(fresh.text().contains("<p>Second</p>"));
    assert!(fresh.text().contains("<h1>Final</h1>"));
    assert_ne!(fresh.header(header::ETAG), etag);

    let other = publish(&app, &ada, "note-2", "Other", "<p>Two</p>")
        .await
        .note();
    assert_ne!(other.url, first.url);
    let listing = listed(&app, &ada).await;
    assert_eq!(
        listing
            .notes
            .iter()
            .map(|note| note.source.as_str())
            .collect::<Vec<_>>(),
        ["note-2", "note-1"]
    );
}

#[tokio::test]
async fn only_the_author_unpublishes_and_guests_cannot_publish() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let bo = seed_member(&app, ServerRole::Member).await;
    let guest = seed_member(&app, ServerRole::Guest).await;
    let note = publish(&app, &ada, "note-1", "Mine", "<p>Mine</p>")
        .await
        .note();

    let refused = publish(&app, &guest, "note-9", "Guest", "<p>No</p>").await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert!(!listed(&app, &guest).await.allowed);
    assert!(listed(&app, &bo).await.notes.is_empty());

    assert_eq!(
        unpublish(&app, &bo, &note.id).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        unpublish(&app, &ada, "not-an-id").await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(visit(&app, &note.url, None).await.status, StatusCode::OK);
    assert_eq!(
        unpublish(&app, &ada, &note.id).await.status,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        visit(&app, &note.url, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert!(listed(&app, &ada).await.notes.is_empty());
    assert_eq!(
        unpublish(&app, &ada, &note.id).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn a_suspended_author_s_pages_go_dark_and_unknown_links_find_nothing() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let note = publish(&app, &ada, "note-1", "Mine", "<p>Mine</p>")
        .await
        .note();
    let account = ada.account_id.to_string();
    app.state
        .db
        .call(move |conn| {
            conn.execute(
                "UPDATE accounts SET status = 'suspended' WHERE id = ?1",
                [account],
            )?;
            Ok(())
        })
        .await
        .expect("suspended");
    assert_eq!(
        visit(&app, &note.url, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        visit(&app, "/n/abcdefghijklmnop", None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        visit(&app, "/n/short", None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        visit(&app, "/n/abcdefgh%27%3B--abcd", None).await.status,
        StatusCode::NOT_FOUND
    );
}

#[tokio::test]
async fn pages_count_toward_the_account_quotas_and_the_size_limit() {
    let mut config = test_config();
    config.quotas = AccountQuotas {
        storage_mb: Some(1),
        uploads_per_hour: Some(3),
        ..AccountQuotas::default()
    };
    config.limits.max_file_mb = 1;
    let app = test_app_with(config).await;
    allow_public_notes(&app, true).await;
    let ada = seed_member(&app, ServerRole::Member).await;

    let huge = format!("<p>{}</p>", "x".repeat(1024 * 1024 + 1));
    let refused = publish(&app, &ada, "note-1", "Huge", &huge).await;
    assert_eq!(refused.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(refused.code(), "page_too_large");

    let half = format!("<p>{}</p>", "x".repeat(600 * 1024));
    assert_eq!(
        publish(&app, &ada, "note-1", "Half", &half).await.status,
        StatusCode::OK
    );
    let full = publish(&app, &ada, "note-2", "Half again", &half).await;
    assert_eq!(full.status, StatusCode::PAYLOAD_TOO_LARGE);
    assert_eq!(full.code(), "account_storage_full");
    assert_eq!(
        publish(&app, &ada, "note-1", "Half", &half).await.status,
        StatusCode::OK,
        "replacing a page frees the room it used"
    );
    assert_eq!(
        publish(&app, &ada, "note-1", "Small", "<p>small</p>")
            .await
            .status,
        StatusCode::OK,
        "refused uploads are not counted"
    );
    let counted = publish(&app, &ada, "note-1", "Smaller", "<p>s</p>").await;
    assert_eq!(counted.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(counted.code(), "too_many_uploads");
}

#[tokio::test]
async fn publishing_and_reading_are_rate_limited() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let mut url = String::new();
    for at in 0..PUBLISH_BURST {
        let answer = publish(&app, &ada, &format!("note-{at}"), "Note", "<p>x</p>").await;
        assert_eq!(answer.status, StatusCode::OK);
        url = answer.note().url;
    }
    let limited = publish(&app, &ada, "note-x", "Note", "<p>x</p>").await;
    assert_eq!(limited.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(limited.code(), "rate_limited");

    for _ in 0..PAGE_BURST {
        assert_eq!(visit(&app, &url, None).await.status, StatusCode::OK);
    }
    let slowed = visit(&app, &url, None).await;
    assert_eq!(slowed.status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(slowed.header(header::RETRY_AFTER), "60");
}

async fn admin_post(app: &TestApp, who: &SeededMember, id: &str, action: &str) -> Answer {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("/api/v1/admin/published-notes/{id}/{action}"))
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", who.access_token),
        )
        .body(Body::empty())
        .expect("request");
    ask(app, request).await
}

async fn admin_listed(app: &TestApp, who: &SeededMember) -> Answer {
    let request = Request::builder()
        .uri("/api/v1/admin/published-notes")
        .header(
            header::AUTHORIZATION,
            format!("Bearer {}", who.access_token),
        )
        .body(Body::empty())
        .expect("request");
    ask(app, request).await
}

async fn logged(app: &TestApp) -> Vec<(String, String, Value)> {
    app.state
        .db
        .read(|conn| {
            let mut statement = conn.prepare(
                "SELECT kind, target, detail FROM security_log WHERE kind LIKE 'note_%' ORDER BY id",
            )?;
            let rows = statement.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })?;
            Ok(rows
                .map(|row| {
                    let (kind, target, detail) = row.expect("a row");
                    (kind, target, serde_json::from_str(&detail).expect("json"))
                })
                .collect())
        })
        .await
        .expect("the log reads")
}

#[tokio::test]
async fn staff_take_a_page_down_and_put_it_back_and_the_author_cannot_republish_meanwhile() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let maintainer = seed_member(&app, ServerRole::Maintainer).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let note = publish(&app, &ada, "note-1", "Reef", "<p>Reef</p>")
        .await
        .note();

    assert_eq!(admin_listed(&app, &ada).await.status, StatusCode::FORBIDDEN);
    assert_eq!(
        admin_post(&app, &ada, &note.id, "take-down").await.status,
        StatusCode::FORBIDDEN
    );
    let listing = admin_listed(&app, &admin).await.json();
    assert_eq!(listing[0]["note"]["id"], note.id);
    assert_eq!(listing[0]["note"]["taken_down"], false);
    assert_eq!(
        listing[0]["author"]["account_id"],
        ada.account_id.to_string()
    );

    let down = admin_post(&app, &maintainer, &note.id, "take-down").await;
    assert_eq!(down.status, StatusCode::OK, "{}", down.text());
    assert_eq!(down.json()["note"]["taken_down"], true);
    assert_eq!(
        visit(&app, &note.url, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert!(listed(&app, &ada).await.notes[0].taken_down);
    let refused = publish(&app, &ada, "note-1", "Reef", "<p>Again</p>").await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "page_taken_down");

    let back = admin_post(&app, &admin, &note.id, "restore").await;
    assert_eq!(back.json()["note"]["taken_down"], false);
    assert_eq!(visit(&app, &note.url, None).await.status, StatusCode::OK);
    assert_eq!(
        admin_post(
            &app,
            &admin,
            "0192a0b0-0000-7000-8000-0000000000ff",
            "restore"
        )
        .await
        .status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        unpublish(&app, &ada, &note.id).await.status,
        StatusCode::NO_CONTENT
    );

    let kinds: Vec<(String, String, Value)> = logged(&app).await;
    assert_eq!(
        kinds
            .iter()
            .map(|(kind, _, _)| kind.as_str())
            .collect::<Vec<_>>(),
        [
            "note_published",
            "note_taken_down",
            "note_restored",
            "note_unpublished"
        ]
    );
    assert!(kinds.iter().all(|(_, target, _)| target == &note.id));
    assert_eq!(kinds[0].2, json!({ "title": "Reef" }));
    assert_eq!(kinds[1].2, json!({ "title": "Reef", "by_admin": true }));
}

#[tokio::test]
async fn unpublishing_a_taken_down_page_keeps_the_note_blocked_until_it_is_put_back() {
    let app = test_app().await;
    allow_public_notes(&app, true).await;
    let admin = seed_member(&app, ServerRole::Admin).await;
    let ada = seed_member(&app, ServerRole::Member).await;
    let note = publish(&app, &ada, "note-1", "Reef", "<p>One</p>")
        .await
        .note();
    publish(&app, &ada, "note-1", "Reef", "<p>Two</p>").await;
    admin_post(&app, &admin, &note.id, "take-down").await;
    assert_eq!(
        unpublish(&app, &ada, &note.id).await.status,
        StatusCode::NO_CONTENT
    );
    assert!(listed(&app, &ada).await.notes.is_empty());
    let listing = admin_listed(&app, &admin).await.json();
    assert_eq!(listing[0]["note"]["id"], note.id);
    assert_eq!(listing[0]["note"]["taken_down"], true);
    assert_eq!(listing[0]["note"]["size"], 0);

    let refused = publish(&app, &ada, "note-1", "Reef", "<p>Three</p>").await;
    assert_eq!(refused.status, StatusCode::FORBIDDEN);
    assert_eq!(refused.code(), "page_taken_down");
    assert!(listed(&app, &ada).await.notes.is_empty());
    assert_eq!(
        unpublish(&app, &ada, &note.id).await.status,
        StatusCode::NOT_FOUND
    );

    let back = admin_post(&app, &admin, &note.id, "restore").await;
    assert_eq!(back.status, StatusCode::OK, "{}", back.text());
    assert!(admin_listed(&app, &admin).await.json()[0].is_null());
    let again = publish(&app, &ada, "note-1", "Reef", "<p>Three</p>")
        .await
        .note();
    assert_ne!(again.id, note.id);
    assert_ne!(again.url, note.url);
    assert_eq!(
        visit(&app, &note.url, None).await.status,
        StatusCode::NOT_FOUND
    );
    assert_eq!(visit(&app, &again.url, None).await.status, StatusCode::OK);

    let kinds: Vec<String> = logged(&app)
        .await
        .into_iter()
        .map(|(kind, _, _)| kind)
        .collect();
    assert_eq!(
        kinds,
        [
            "note_published",
            "note_taken_down",
            "note_unpublished",
            "note_restored",
            "note_published"
        ]
    );
}
