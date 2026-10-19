use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_online::test_support::{FixtureServer, Reply, Request};
use serde_json::{json, Value};

use super::*;

const IMAGE: &str = "iVBORw0KGgo=";

fn keys() -> MathpixKeys {
    MathpixKeys {
        app_id: "app_123".into(),
        app_key: "sk-secret-123".into(),
    }
}

fn envelope(error: &str) -> Value {
    let json = error
        .strip_prefix(crate::app_error::PREFIX)
        .unwrap_or_else(|| panic!("not an app error: {error}"));
    serde_json::from_str(json).unwrap()
}

fn error_code(error: &str) -> String {
    envelope(error)["code"].as_str().unwrap().to_owned()
}

fn error_param(error: &str, name: &str) -> String {
    envelope(error)["params"][name]
        .as_str()
        .unwrap_or_default()
        .to_owned()
}

async fn serve(handler: impl Fn(&Request) -> Reply + Send + Sync + 'static) -> FixtureServer {
    FixtureServer::start(Arc::new(handler)).await
}

impl Api {
    fn for_tests(base: &str) -> Self {
        Self::with(
            base,
            PollPlan {
                first: Duration::from_millis(1),
                factor: 1.5,
                max: Duration::from_millis(5),
                deadline: Duration::from_secs(2),
            },
        )
        .unwrap()
    }
}

fn reply(status: u16, body: &str) -> Reply {
    Reply {
        status,
        headers: Vec::new(),
        body: body.as_bytes().to_vec(),
    }
}

#[test]
fn credentials_refuse_header_breaking_characters() {
    assert!(valid_credential("app_123-ABC.x").is_ok());
    assert!(valid_credential(&"k".repeat(256)).is_ok());
    let long = "k".repeat(257);
    for bad in [
        "",
        "a b",
        "abc\r\nX-Evil: 1",
        "tab\tkey",
        "naïve",
        long.as_str(),
    ] {
        let error = valid_credential(bad).unwrap_err();
        assert_eq!(error_code(&error), "mathpix.invalid_keys", "{bad:?}");
    }
}

#[test]
fn debug_output_never_shows_the_app_key() {
    let text = format!("{:?}", keys());
    assert!(text.contains("app_123"));
    assert!(!text.contains("sk-secret-123"));
    let headers = keys().headers().unwrap();
    assert!(headers.get("app_key").unwrap().is_sensitive());
    assert_eq!(headers.get("app_id").unwrap(), "app_123");
    assert!(!format!("{headers:?}").contains("sk-secret-123"));
}

#[test]
fn pdf_ids_and_page_ranges_are_validated_before_any_url_is_built() {
    assert!(valid_pdf_id("2024_01_ab-cd").is_ok());
    for bad in ["../x", "a/b", "", "a b", "id?x=1", "a.mmd"] {
        assert_eq!(
            error_code(&valid_pdf_id(bad).unwrap_err()),
            "mathpix.invalid_response",
            "{bad}"
        );
    }
    assert!(valid_pdf_id(&"a".repeat(129)).is_err());
    for good in ["1-50", "2,4-6", "7", "3-3"] {
        assert!(valid_page_ranges(good).is_ok(), "{good}");
    }
    for bad in ["1-2;rm", "", "0-3", "a-b", "1-", ",", "1--2", "1-2,"] {
        assert!(valid_page_ranges(bad).is_err(), "{bad}");
    }
}

#[test]
fn only_the_main_window_may_use_mathpix() {
    assert!(require_main_window(Some("main")).is_ok());
    for label in [Some("preview"), Some("presenter"), None] {
        assert_eq!(
            error_code(&require_main_window(label).unwrap_err()),
            "mathpix.wrong_window"
        );
    }
}

#[test]
fn reasons_lose_control_characters_and_both_credentials() {
    let keys = keys();
    assert_eq!(
        sanitize_reason("  Bad\n\tPDF \u{7} for app_123 ", &keys),
        "Bad PDF for …"
    );
    assert_eq!(
        sanitize_reason("key sk-sec\u{7}ret-123 refused", &keys),
        "key … refused"
    );
    assert_eq!(sanitize_reason("key sk-secret -123 refused", &keys), "…");
    assert_eq!(
        sanitize_reason(&"y".repeat(500), &keys).chars().count(),
        200
    );
}

#[tokio::test]
async fn text_requests_put_keys_only_in_headers_and_ask_mathpix_not_to_keep_the_image() {
    let server = serve(|_| Reply::ok(r#"{"text":"\\(x\\)","confidence":0.5}"#)).await;
    let result = Api::for_tests(&server.base)
        .text(&keys(), IMAGE, "image/png")
        .await
        .unwrap();
    assert_eq!(
        result,
        MathpixTextResult {
            text: "\\(x\\)".into(),
            latex_styled: None,
            confidence: Some(0.5),
        }
    );
    let requests = server.requests("/");
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.path, "/v3/text");
    assert_eq!(
        request.headers.get("app_id").map(String::as_str),
        Some("app_123")
    );
    assert_eq!(
        request.headers.get("app_key").map(String::as_str),
        Some("sk-secret-123")
    );
    assert!(!request.path.contains("secret") && !request.path.contains("app_123"));
    assert!(!request.body.contains("sk-secret-123"));
    let body: Value = serde_json::from_str(&request.body).unwrap();
    assert_eq!(body["src"], format!("data:image/png;base64,{IMAGE}"));
    assert_eq!(body["formats"], json!(["text", "latex_styled"]));
    assert_eq!(body["math_inline_delimiters"], json!(["\\(", "\\)"]));
    assert_eq!(body["math_display_delimiters"], json!(["\\[", "\\]"]));
    assert_eq!(body["rm_spaces"], true);
    assert_eq!(body["metadata"]["improve_mathpix"], false);
}

#[tokio::test]
async fn a_single_equation_comes_back_as_latex_styled() {
    let server =
        serve(|_| Reply::ok(r#"{"text":"\\[x^2\\]","latex_styled":"x^2","confidence":0.98}"#))
            .await;
    let result = Api::for_tests(&server.base)
        .text(&keys(), IMAGE, "image/jpeg")
        .await
        .unwrap();
    assert_eq!(
        result,
        MathpixTextResult {
            text: "\\[x^2\\]".into(),
            latex_styled: Some("x^2".into()),
            confidence: Some(0.98),
        }
    );
}

#[tokio::test]
async fn images_mathpix_cannot_take_are_refused_before_any_request() {
    let server = serve(|_| Reply::ok("{}")).await;
    let api = Api::for_tests(&server.base);
    for (image, mime) in [
        (IMAGE, "image/webp"),
        ("", "image/png"),
        ("a\"b", "image/png"),
    ] {
        let error = api.text(&keys(), image, mime).await.unwrap_err();
        assert_eq!(error_code(&error), "mathpix.invalid_response");
    }
    assert!(server.requests("/").is_empty());
}

#[tokio::test]
async fn a_rejected_key_is_reported_without_echoing_it() {
    let server = serve(|_| reply(401, r#"{"error":"bad key sk-secret-123"}"#)).await;
    let error = Api::for_tests(&server.base)
        .text(&keys(), IMAGE, "image/png")
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.key_rejected");
    assert!(!error.contains("sk-secret-123"));
    assert!(!error.contains("bad key"));
}

#[tokio::test]
async fn rate_limits_and_server_errors_have_their_own_messages() {
    let status = Arc::new(AtomicUsize::new(429));
    let answer = Arc::clone(&status);
    let server = serve(move |_| reply(answer.load(Ordering::SeqCst) as u16, "{}")).await;
    let api = Api::for_tests(&server.base);
    let error = api.text(&keys(), IMAGE, "image/png").await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.rate_limited");
    status.store(413, Ordering::SeqCst);
    let error = api.text(&keys(), IMAGE, "image/png").await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.image_too_large");
    status.store(502, Ordering::SeqCst);
    let error = api.text(&keys(), IMAGE, "image/png").await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.http_error");
    assert_eq!(error_param(&error, "status"), "502");

    let free = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = free.local_addr().unwrap();
    drop(free);
    let closed = Api::for_tests(&format!("http://{address}"));
    let error = closed.text(&keys(), IMAGE, "image/png").await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.unreachable");
    assert!(!error.contains(&address.to_string()));
}

#[tokio::test]
async fn redirects_are_never_followed_with_credentials() {
    let target = serve(|_| Reply::ok(r#"{"text":"x"}"#)).await;
    let location = format!("{}/v3/text", target.base);
    let origin = serve(move |_| Reply::status(302).header("Location", &location)).await;
    let error = Api::for_tests(&origin.base)
        .text(&keys(), IMAGE, "image/png")
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.http_error");
    assert_eq!(error_param(&error, "status"), "302");
    assert!(target.requests("/").is_empty());
}

#[tokio::test]
async fn a_mathpix_error_field_is_shown_trimmed_and_without_keys() {
    let reason = format!("Image too small \u{7} sk-secret-123 {}", "x".repeat(500));
    let body = json!({ "error": reason }).to_string();
    let server = serve(move |_| Reply::ok(body.clone())).await;
    let error = Api::for_tests(&server.base)
        .text(&keys(), IMAGE, "image/png")
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.rejected");
    let shown = error_param(&error, "reason");
    assert!(shown.chars().count() <= 200);
    assert!(!shown.chars().any(char::is_control));
    assert!(!shown.contains("sk-secret-123"));
    assert!(shown.starts_with("Image too small …"), "{shown}");
}

#[test]
fn multipart_bodies_frame_options_and_file_with_crlf() {
    assert_eq!(
        multipart_body("B", "{\"a\":1}", b"%PDF-1"),
        b"--B\r\nContent-Disposition: form-data; name=\"options_json\"\r\n\r\n{\"a\":1}\r\n--B\r\nContent-Disposition: form-data; name=\"file\"; filename=\"document.pdf\"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1\r\n--B--\r\n"
    );
}

#[test]
fn a_boundary_that_occurs_in_the_pdf_is_never_used() {
    assert_eq!(
        pick_boundary(
            b"..--oleafly-aa..",
            ["oleafly-aa".to_string(), "oleafly-bb".to_string()]
        )
        .as_deref(),
        Some("oleafly-bb")
    );
    assert_eq!(
        pick_boundary(b"--oleafly-aa", ["oleafly-aa".to_string()]),
        None
    );
    let boundary = random_boundary();
    assert_eq!(boundary.len(), "oleafly-".len() + 32);
    assert!(boundary["oleafly-".len()..]
        .bytes()
        .all(|byte| byte.is_ascii_hexdigit()));
}

fn options_part(body: &str) -> Value {
    let marker = "name=\"options_json\"\r\n\r\n";
    let start = body.find(marker).unwrap() + marker.len();
    let end = start + body[start..].find("\r\n--").unwrap();
    serde_json::from_str(&body[start..end]).unwrap()
}

#[tokio::test]
async fn pdf_upload_sends_the_page_range_and_privacy_options() {
    let server = serve(|_| Reply::ok(r#"{"pdf_id":"2026_10_19_abc-def"}"#)).await;
    let api = Api::for_tests(&server.base);
    let id = api
        .pdf_upload(&keys(), b"%PDF-1.7 scanned pages", Some("3-5"))
        .await
        .unwrap();
    assert_eq!(id, "2026_10_19_abc-def");
    let requests = server.requests("/v3/pdf");
    assert_eq!(requests.len(), 1);
    let request = &requests[0];
    assert_eq!(request.method, "POST");
    assert_eq!(request.headers["app_key"], "sk-secret-123");
    let boundary = request.headers["content-type"]
        .strip_prefix("multipart/form-data; boundary=")
        .unwrap()
        .to_owned();
    assert!(boundary.starts_with("oleafly-"));
    let options = options_part(&request.body);
    assert_eq!(options["page_ranges"], "3-5");
    assert_eq!(options["include_page_breaks"], true);
    assert_eq!(options["metadata"]["improve_mathpix"], false);
    assert_eq!(options["math_inline_delimiters"], json!(["\\(", "\\)"]));
    assert!(request.body.contains("filename=\"document.pdf\""));
    assert!(request.body.contains("%PDF-1.7 scanned pages"));
    assert!(request.body.ends_with(&format!("\r\n--{boundary}--\r\n")));
    assert!(!request.body.contains("sk-secret-123"));

    let error = api
        .pdf_upload(&keys(), b"%PDF", Some("1-2;rm"))
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.invalid_response");
    assert_eq!(server.requests("/").len(), 1);
}

#[tokio::test]
async fn an_unsafe_pdf_id_from_mathpix_is_refused() {
    let server = serve(|_| Reply::ok(r#"{"pdf_id":"../../v3/admin"}"#)).await;
    let error = Api::for_tests(&server.base)
        .pdf_upload(&keys(), b"%PDF", None)
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.invalid_response");
}

#[tokio::test]
async fn pdf_wait_polls_until_completed_reads_the_markdown_and_deletes_it() {
    let polls = Arc::new(AtomicUsize::new(0));
    let reads = Arc::new(AtomicUsize::new(0));
    let (poll_count, read_count) = (Arc::clone(&polls), Arc::clone(&reads));
    let server = serve(
        move |request| match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/v3/pdf/ID1") => {
                if poll_count.fetch_add(1, Ordering::SeqCst) == 0 {
                    Reply::ok(r#"{"status":"split","num_pages":2,"num_pages_completed":1}"#)
                } else {
                    Reply::ok(r#"{"status":"completed","num_pages":2,"num_pages_completed":2}"#)
                }
            }
            ("GET", "/v3/pdf/ID1.mmd") => {
                if read_count.fetch_add(1, Ordering::SeqCst) == 0 {
                    Reply::status(202).header("Retry-After", "0")
                } else {
                    Reply::ok("P1\n\\pagebreak\nP2")
                }
            }
            ("DELETE", "/v3/pdf/ID1") => Reply::ok("{}"),
            _ => Reply::status(404),
        },
    )
    .await;
    let events = Mutex::new(Vec::new());
    let cancelled = AtomicBool::new(false);
    let markdown = Api::for_tests(&server.base)
        .pdf_wait(&keys(), "ID1", &cancelled, &|progress| {
            events.lock().unwrap().push(progress)
        })
        .await
        .unwrap();
    assert_eq!(markdown, "P1\n\\pagebreak\nP2");
    assert_eq!(
        events.into_inner().unwrap(),
        vec![
            MathpixPdfProgress {
                status: "split".into(),
                pages_done: 1,
                pages_total: 2,
            },
            MathpixPdfProgress {
                status: "completed".into(),
                pages_done: 2,
                pages_total: 2,
            },
        ]
    );
    let all = server.requests("/");
    let last = all.last().unwrap();
    assert_eq!(
        (last.method.as_str(), last.path.as_str()),
        ("DELETE", "/v3/pdf/ID1")
    );
    assert_eq!(server.requests("/v3/pdf/ID1.mmd").len(), 2);
    assert!(
        all.iter()
            .all(|request| request.headers.get("app_key").map(String::as_str)
                == Some("sk-secret-123"))
    );
}

#[tokio::test]
async fn cancelling_stops_polling_and_deletes_the_pdf() {
    let server = serve(|request| {
        if request.method == "DELETE" {
            Reply::ok("{}")
        } else {
            Reply::ok(r#"{"status":"split"}"#)
        }
    })
    .await;
    let cancelled = AtomicBool::new(true);
    let error = Api::for_tests(&server.base)
        .pdf_wait(&keys(), "ID2", &cancelled, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.cancelled");
    let requests = server.requests("/");
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0].method, "DELETE");
    assert_eq!(requests[0].path, "/v3/pdf/ID2");
}

#[tokio::test]
async fn a_cancel_during_polling_stops_the_wait_promptly() {
    let server = serve(|request| {
        if request.method == "DELETE" {
            Reply::ok("{}")
        } else {
            Reply::ok(r#"{"status":"split","num_pages":9}"#)
        }
    })
    .await;
    let cancelled = Arc::new(AtomicBool::new(false));
    let stop = Arc::clone(&cancelled);
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        stop.store(true, Ordering::SeqCst);
    });
    let started = std::time::Instant::now();
    let error = Api::for_tests(&server.base)
        .pdf_wait(&keys(), "ID5", &cancelled, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.cancelled");
    assert!(started.elapsed() < Duration::from_secs(1));
    assert_eq!(server.requests("/").last().unwrap().method, "DELETE");
}

#[tokio::test]
async fn a_pdf_that_never_finishes_times_out_and_is_deleted() {
    let server = serve(|request| {
        if request.method == "DELETE" {
            Reply::ok("{}")
        } else {
            Reply::ok(r#"{"status":"split"}"#)
        }
    })
    .await;
    let mut api = Api::for_tests(&server.base);
    api.poll.deadline = Duration::from_millis(20);
    let cancelled = AtomicBool::new(false);
    let error = api
        .pdf_wait(&keys(), "ID3", &cancelled, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.timed_out");
    let last = server.requests("/").pop().unwrap();
    assert_eq!(
        (last.method.as_str(), last.path.as_str()),
        ("DELETE", "/v3/pdf/ID3")
    );
}

#[tokio::test]
async fn a_failed_pdf_reports_mathpixs_reason() {
    let server = serve(|request| {
        if request.method == "DELETE" {
            Reply::ok("{}")
        } else {
            Reply::ok(r#"{"status":"error","error":"Bad PDF"}"#)
        }
    })
    .await;
    let cancelled = AtomicBool::new(false);
    let error = Api::for_tests(&server.base)
        .pdf_wait(&keys(), "ID4", &cancelled, &|_| {})
        .await
        .unwrap_err();
    assert_eq!(error_code(&error), "mathpix.rejected");
    assert_eq!(error_param(&error, "reason"), "Bad PDF");
    assert_eq!(server.requests("/").last().unwrap().method, "DELETE");
}

#[tokio::test]
async fn oversized_inputs_and_replies_are_refused() {
    let server = serve(|_| Reply::ok(vec![b'x'; MAX_MMD_BYTES + 1])).await;
    let api = Api::for_tests(&server.base);

    let pdf = vec![0_u8; MAX_PDF_BYTES + 1];
    let error = api.pdf_upload(&keys(), &pdf, None).await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.pdf_too_large");
    drop(pdf);

    let image = "A".repeat(MAX_IMAGE_BASE64_CHARS + 1);
    let error = api.text(&keys(), &image, "image/png").await.unwrap_err();
    assert_eq!(error_code(&error), "mathpix.image_too_large");
    assert!(server.requests("/").is_empty());

    let Err(error) = api.pdf_mmd(&keys(), "ID6").await else {
        panic!("a 32 MB + 1 reply must be refused");
    };
    assert_eq!(error_code(&error), "mathpix.invalid_response");
}

#[test]
fn raw_and_linux_json_bodies_both_carry_the_pdf() {
    let raw = tauri::ipc::InvokeBody::Raw(b"%PDF".to_vec());
    assert_eq!(&*upload_bytes(&raw).unwrap(), b"%PDF");
    let json = tauri::ipc::InvokeBody::Json(json!([37, 80, 68, 70]));
    assert_eq!(&*upload_bytes(&json).unwrap(), b"%PDF");
    for bad in [json!([256]), json!({ "pdf": "x" }), json!(["%"])] {
        let error = upload_bytes(&tauri::ipc::InvokeBody::Json(bad)).unwrap_err();
        assert_eq!(error_code(&error), "mathpix.invalid_response");
    }
}

#[test]
fn the_page_range_header_is_optional_but_must_be_valid() {
    let mut headers = tauri::http::HeaderMap::new();
    assert_eq!(page_ranges_header(&headers).unwrap(), None);
    headers.insert(PAGE_RANGES_HEADER, "3-5".parse().unwrap());
    assert_eq!(
        page_ranges_header(&headers).unwrap().as_deref(),
        Some("3-5")
    );
    headers.insert(PAGE_RANGES_HEADER, "1;rm -rf".parse().unwrap());
    assert!(page_ranges_header(&headers).is_err());
}

#[test]
fn a_cancel_that_arrives_before_the_wait_still_stops_it() {
    let registry = CancelRegistry::default();
    registry.cancel("early-request");
    let early = registry.register("early-request");
    assert!(early.flag.load(Ordering::SeqCst));
    drop(early);
    assert!(!registry.lock().contains_key("early-request"));

    let late = registry.register("late-request");
    assert!(!late.flag.load(Ordering::SeqCst));
    registry.cancel("late-request");
    assert!(late.flag.load(Ordering::SeqCst));
    drop(late);
    assert!(registry.lock().is_empty());

    registry.cancel("../not an id");
    assert!(registry.lock().is_empty());
}

#[test]
fn the_cancel_registry_stays_bounded() {
    let registry = CancelRegistry::default();
    for index in 0..(MAX_CANCEL_ENTRIES * 3) {
        registry.cancel(&format!("stale-{index}"));
    }
    assert!(registry.lock().len() <= MAX_CANCEL_ENTRIES);
    let active = registry.register("active");
    assert!(!active.flag.load(Ordering::SeqCst));
    assert!(registry.lock().len() <= MAX_CANCEL_ENTRIES);
}

#[test]
fn saving_keys_checks_them_with_a_free_app_token_first() {
    let _env_guard = crate::paths::data_dir_env_lock();
    let dir = tempfile::tempdir().unwrap();
    std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    runtime.block_on(async {
        let accept = Arc::new(AtomicBool::new(false));
        let answer = Arc::clone(&accept);
        let server = serve(move |_| {
            if answer.load(Ordering::SeqCst) {
                Reply::ok(r#"{"app_token":"token","app_token_expires_at":1}"#)
            } else {
                Reply::status(401)
            }
        })
        .await;
        let api = Api::for_tests(&server.base);

        let error = save_keys_with(&api, "app_123", "sk-secret-123")
            .await
            .unwrap_err();
        assert_eq!(error_code(&error), "mathpix.key_rejected");
        assert!(stored_keys().unwrap().is_none());
        assert_eq!(
            key_status(),
            MathpixKeyStatus {
                configured: false,
                app_id: None,
            }
        );

        let error = save_keys_with(&api, "app 123", "sk-secret-123")
            .await
            .unwrap_err();
        assert_eq!(error_code(&error), "mathpix.invalid_keys");
        assert_eq!(server.requests("/").len(), 1);

        accept.store(true, Ordering::SeqCst);
        let status = save_keys_with(&api, " app_123 ", " sk-secret-123 ")
            .await
            .unwrap();
        assert_eq!(
            status,
            MathpixKeyStatus {
                configured: true,
                app_id: Some("app_123".into()),
            }
        );
        let request = server.requests("/v3/app-tokens").pop().unwrap();
        assert_eq!(request.method, "POST");
        assert_eq!(
            serde_json::from_str::<Value>(&request.body).unwrap(),
            json!({ "expires": 30 })
        );
        assert_eq!(request.headers["app_id"], "app_123");
        assert_eq!(request.headers["app_key"], "sk-secret-123");
    });

    let stored = crate::secrets::read_connector_secrets().unwrap();
    assert_eq!(stored[APP_ID_ACCOUNT], "app_123");
    assert_eq!(stored[APP_KEY_ACCOUNT], "sk-secret-123");
    assert_eq!(
        key_status(),
        MathpixKeyStatus {
            configured: true,
            app_id: Some("app_123".into()),
        }
    );
    assert!(!serde_json::to_string(&key_status())
        .unwrap()
        .contains("sk-secret-123"));
    // The generic connector command never hands the key out.
    assert_eq!(
        crate::connectors::get_connector_key(APP_KEY_ACCOUNT.into()).unwrap(),
        None
    );
    clear_keys().unwrap();
    assert_eq!(
        key_status(),
        MathpixKeyStatus {
            configured: false,
            app_id: None,
        }
    );
    std::env::remove_var("OLEAFLY_DATA_DIR");
}
