use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use reqwest::header::{ACCEPT, CONTENT_TYPE, LOCATION, USER_AGENT};
use reqwest::Url;
use serde::Serialize;

mod client;
mod html;
mod preview;
mod robots;
mod search;

use client::{redirect_allowed, PublicResolver};
pub use preview::{link_preview, LinkPreview};
use robots::Robots;

pub const MAX_FETCH_BYTES: usize = 5 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 60 * 1024;
pub const MAX_SEARCH_RESULTS: usize = 10;
pub const ROBOTS_TOKEN: &str = "Oleafly";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const API_TIMEOUT: Duration = Duration::from_secs(20);
const ROBOTS_TIMEOUT: Duration = Duration::from_secs(10);
const ROBOTS_MAX_BYTES: usize = 512 * 1024;
const ROBOTS_TTL: Duration = Duration::from_secs(60 * 60);
const ROBOTS_CACHE: usize = 256;

const FETCH_ACCEPT: &str = "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5";
const EXTRACT_TIMEOUT: Duration = Duration::from_secs(10);
const EXTRACT_STACK_BYTES: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebError {
    InvalidUrl(String),
    NotAllowed(String),
    Robots {
        url: String,
        unreachable: bool,
    },
    Http(u16),
    Unsupported(String),
    Pdf,
    Transport(String),
    Timeout,
    Search {
        provider: &'static str,
        status: Option<u16>,
    },
}

impl std::fmt::Display for WebError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WebError::InvalidUrl(_) => f.write_str("This URL is not valid."),
            WebError::NotAllowed(message) | WebError::Unsupported(message) => f.write_str(message),
            WebError::Robots {
                unreachable: false, ..
            } => f.write_str("This site's robots.txt does not allow Oleafly to read this page."),
            WebError::Robots {
                unreachable: true, ..
            } => f.write_str(
                "This site's robots.txt could not be read, so Oleafly did not fetch the page.",
            ),
            WebError::Http(status) => write!(f, "The site returned HTTP {status}."),
            WebError::Pdf => {
                f.write_str("This is a PDF. Ask the user to attach it, or use read_paper.")
            }
            WebError::Transport(_) => f.write_str("Could not reach the site."),
            WebError::Timeout => f.write_str("The site took too long to answer."),
            WebError::Search {
                provider,
                status: Some(401 | 403),
            } => write!(f, "{provider} rejected the web search key."),
            WebError::Search {
                provider,
                status: Some(429),
            } => write!(f, "{provider} is rate-limiting searches. Try again later."),
            WebError::Search {
                provider,
                status: Some(status),
            } => write!(f, "{provider} returned HTTP {status}."),
            WebError::Search {
                provider,
                status: None,
            } => write!(f, "Could not reach {provider}."),
        }
    }
}

impl std::error::Error for WebError {}

pub type WebResult<T> = std::result::Result<T, WebError>;

#[derive(Debug, Clone)]
pub struct WebFetchOptions {
    pub user_agent: String,
    pub respect_robots: bool,
    pub timeout: Duration,
}

impl Default for WebFetchOptions {
    fn default() -> Self {
        WebFetchOptions {
            user_agent: ROBOTS_TOKEN.to_string(),
            respect_robots: true,
            timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct WebPage {
    pub url: String,
    pub requested_url: String,
    pub title: Option<String>,
    pub content_type: String,
    pub markdown: String,
    pub truncated: bool,
    pub links: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchKey {
    Brave(String),
    Tavily(String),
    Serper(String),
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub title: String,
    pub url: String,
    pub snippet: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub published: Option<String>,
}

struct CachedRobots {
    robots: Robots,
    unreachable: bool,
    at: Instant,
}

pub struct WebClient {
    fetch: reqwest::Client,
    pub(crate) api: reqwest::Client,
    strict: bool,
    robots: Mutex<HashMap<String, CachedRobots>>,
}

fn build_error(error: reqwest::Error) -> WebError {
    WebError::Transport(error.to_string())
}

pub fn check_public_https_url(url: &Url) -> WebResult<()> {
    client::check_url(url)
}

pub fn public_https_client(user_agent: &str, timeout: Duration) -> WebResult<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(user_agent)
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if redirect_allowed(attempt.url(), attempt.previous().len()) {
                attempt.follow()
            } else {
                attempt.error("redirect to a disallowed address")
            }
        }))
        .dns_resolver(Arc::new(PublicResolver))
        .build()
        .map_err(build_error)
}

impl WebClient {
    pub fn new(user_agent: &str) -> WebResult<WebClient> {
        let fetch = reqwest::Client::builder()
            .user_agent(user_agent)
            .connect_timeout(CONNECT_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(PublicResolver))
            .build()
            .map_err(build_error)?;
        let api = reqwest::Client::builder()
            .user_agent(user_agent)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(API_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(build_error)?;
        Ok(WebClient {
            fetch,
            api,
            strict: true,
            robots: Mutex::new(HashMap::new()),
        })
    }

    fn check(&self, url: &Url) -> WebResult<()> {
        if self.strict {
            client::check_url(url)
        } else if matches!(url.scheme(), "http" | "https") {
            Ok(())
        } else {
            Err(WebError::InvalidUrl(url.to_string()))
        }
    }

    /// The answer for a site's robots.txt, following up to five redirects as
    /// RFC 9309 asks, each to an address a fetch may reach. `None` when it
    /// cannot be reached.
    async fn get_robots(&self, mut url: Url, opts: &WebFetchOptions) -> Option<reqwest::Response> {
        for _ in 0..=client::MAX_REDIRECTS {
            if self.strict {
                client::check_resolved_host(&url).await.ok()?;
            }
            let response = self
                .fetch
                .get(url.clone())
                .header(USER_AGENT, &opts.user_agent)
                .timeout(ROBOTS_TIMEOUT)
                .send()
                .await
                .ok()?;
            match redirect_target(&response, &url) {
                Some(next) => {
                    self.check(&next).ok()?;
                    url = next;
                }
                None => return Some(response),
            }
        }
        None
    }

    async fn robots_for(&self, url: &Url, opts: &WebFetchOptions) -> (Robots, bool) {
        let origin = url.origin().ascii_serialization();
        if let Some(cached) = self
            .robots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&origin)
            .filter(|cached| cached.at.elapsed() < ROBOTS_TTL)
        {
            return (cached.robots.clone(), cached.unreachable);
        }
        let (robots, unreachable) = match url.join("/robots.txt") {
            Ok(robots_url) => match self.get_robots(robots_url, opts).await {
                Some(response) if response.status().is_success() => {
                    match read_limited(response, ROBOTS_MAX_BYTES).await {
                        Ok((bytes, _)) => (Robots::parse(&String::from_utf8_lossy(&bytes)), false),
                        Err(_) => (Robots::disallow_all(), true),
                    }
                }
                Some(response) if response.status().is_client_error() => {
                    (Robots::allow_all(), false)
                }
                _ => (Robots::disallow_all(), true),
            },
            Err(_) => (Robots::disallow_all(), true),
        };
        let mut cache = self
            .robots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if cache.len() >= ROBOTS_CACHE {
            if let Some(oldest) = cache
                .iter()
                .min_by_key(|(_, cached)| cached.at)
                .map(|(origin, _)| origin.clone())
            {
                cache.remove(&oldest);
            }
        }
        cache.insert(
            origin,
            CachedRobots {
                robots: robots.clone(),
                unreachable,
                at: Instant::now(),
            },
        );
        (robots, unreachable)
    }
}

pub async fn read_limited(
    mut response: reqwest::Response,
    max: usize,
) -> std::result::Result<(Vec<u8>, bool), reqwest::Error> {
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await? {
        let room = max - body.len();
        if chunk.len() > room {
            body.extend_from_slice(&chunk[..room]);
            return Ok((body, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, false))
}

fn fetch_error(error: reqwest::Error) -> WebError {
    if error.is_timeout() {
        return WebError::Timeout;
    }
    let mut chain = error.to_string();
    let mut source = std::error::Error::source(&error);
    while let Some(inner) = source {
        chain.push_str(": ");
        chain.push_str(&inner.to_string());
        source = inner.source();
    }
    if error.is_redirect()
        || chain.contains("disallowed address")
        || chain.contains("no public address")
    {
        return WebError::NotAllowed(
            "Oleafly does not fetch local or private network addresses.".into(),
        );
    }
    WebError::Transport(chain)
}

enum Kind {
    Html,
    Text,
}

fn kind_of(mime: &str) -> WebResult<Kind> {
    match mime {
        "text/html" | "application/xhtml+xml" => Ok(Kind::Html),
        "text/plain"
        | "text/markdown"
        | "text/csv"
        | "application/json"
        | "application/xml"
        | "text/xml"
        | "application/rss+xml"
        | "application/atom+xml" => Ok(Kind::Text),
        mime if mime.ends_with("+json") => Ok(Kind::Text),
        "application/pdf" => Err(WebError::Pdf),
        _ => Err(WebError::Unsupported(
            "This content type is not supported.".into(),
        )),
    }
}

fn cut_at_char_boundary(text: &mut String, max: usize) {
    if text.len() <= max {
        return;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
}

fn redirect_blocked() -> WebError {
    WebError::NotAllowed("Oleafly does not fetch local or private network addresses.".into())
}

async fn check_robots(client: &WebClient, target: &Url, opts: &WebFetchOptions) -> WebResult<()> {
    if !opts.respect_robots {
        return Ok(());
    }
    let (robots, unreachable) = client.robots_for(target, opts).await;
    let path = match target.query() {
        Some(query) => format!("{}?{query}", target.path()),
        None => target.path().to_string(),
    };
    if robots.allows(ROBOTS_TOKEN, &path) {
        Ok(())
    } else {
        Err(WebError::Robots {
            url: target.to_string(),
            unreachable,
        })
    }
}

fn redirect_target(response: &reqwest::Response, from: &Url) -> Option<Url> {
    if !matches!(response.status().as_u16(), 301 | 302 | 303 | 307 | 308) {
        return None;
    }
    let location = response.headers().get(LOCATION)?.to_str().ok()?;
    let mut next = from.join(location).ok()?;
    next.set_fragment(None);
    Some(next)
}

async fn within<T>(limit: Duration, future: impl std::future::Future<Output = T>) -> WebResult<T> {
    tokio::time::timeout(limit, future)
        .await
        .map_err(|_| WebError::Timeout)
}

async fn extract_html(text: String, base: Url, limit: Duration) -> html::Extracted {
    let text: Arc<str> = Arc::from(text);
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let page = text.clone();
    let spawned = std::thread::Builder::new()
        .name("oleafly-web-extract".into())
        .stack_size(EXTRACT_STACK_BYTES)
        .spawn(move || {
            let _ = sender.send(html::extract(&page, &base));
        });
    if spawned.is_ok() {
        if let Ok(Ok(extracted)) = tokio::time::timeout(limit, receiver).await {
            return extracted;
        }
    }
    tokio::task::spawn_blocking(move || html::flatten(&text))
        .await
        .unwrap_or_else(|_| html::Extracted {
            title: None,
            markdown: String::new(),
            links: Vec::new(),
        })
}

fn deadline_after(timeout: Duration) -> Instant {
    Instant::now()
        .checked_add(timeout)
        .unwrap_or_else(|| Instant::now() + Duration::from_secs(24 * 60 * 60))
}

async fn open_page(
    client: &WebClient,
    url: &str,
    opts: &WebFetchOptions,
    deadline: Instant,
) -> WebResult<reqwest::Response> {
    let mut target = Url::parse(url.trim()).map_err(|_| WebError::InvalidUrl(url.to_string()))?;
    if client.strict && target.scheme() == "http" {
        target
            .set_scheme("https")
            .map_err(|_| WebError::InvalidUrl(url.to_string()))?;
    }
    target.set_fragment(None);
    client.check(&target)?;
    let remaining = || deadline.saturating_duration_since(Instant::now());
    let mut hops = 0usize;
    let response = loop {
        if client.strict {
            within(remaining(), client::check_resolved_host(&target)).await??;
        }
        within(remaining(), check_robots(client, &target, opts)).await??;
        let response = within(
            remaining(),
            client
                .fetch
                .get(target.clone())
                .header(ACCEPT, FETCH_ACCEPT)
                .header(USER_AGENT, &opts.user_agent)
                .send(),
        )
        .await?
        .map_err(fetch_error)?;
        let Some(next) = redirect_target(&response, &target) else {
            break response;
        };
        hops += 1;
        if hops > client::MAX_REDIRECTS {
            return Err(redirect_blocked());
        }
        client.check(&next).map_err(|_| redirect_blocked())?;
        target = next;
    };
    if !response.status().is_success() {
        return Err(WebError::Http(response.status().as_u16()));
    }
    Ok(response)
}

fn mime_of(content_type: Option<&str>) -> String {
    content_type
        .and_then(|value| value.split(';').next())
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "text/plain".to_string())
}

pub async fn web_fetch(
    client: &WebClient,
    url: &str,
    opts: &WebFetchOptions,
) -> WebResult<WebPage> {
    let deadline = deadline_after(opts.timeout);
    let remaining = || deadline.saturating_duration_since(Instant::now());
    let response = open_page(client, url, opts, deadline).await?;
    let final_url = response.url().clone();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    let mime = mime_of(content_type.as_deref());
    let kind = kind_of(&mime)?;
    let (bytes, mut truncated) = within(remaining(), read_limited(response, MAX_FETCH_BYTES))
        .await?
        .map_err(fetch_error)?;
    let text = html::decode_body(&bytes, content_type.as_deref());
    let (title, mut markdown, links) = match kind {
        Kind::Html => {
            let extracted = extract_html(text, final_url.clone(), EXTRACT_TIMEOUT).await;
            (extracted.title, extracted.markdown, extracted.links)
        }
        Kind::Text => (None, text, Vec::new()),
    };
    // Decoding can grow the text past the cap (a Cyrillic page in
    // windows-1251 doubles), and what is cut off is not read either.
    truncated |= markdown.len() > MAX_FETCH_BYTES;
    cut_at_char_boundary(&mut markdown, MAX_FETCH_BYTES);
    Ok(WebPage {
        url: final_url.to_string(),
        requested_url: url.to_string(),
        title,
        content_type: mime,
        markdown,
        truncated,
        links,
    })
}

pub async fn web_search(
    client: &WebClient,
    query: &str,
    key: &SearchKey,
) -> WebResult<Vec<SearchHit>> {
    search::search(client, query, key, MAX_SEARCH_RESULTS).await
}
