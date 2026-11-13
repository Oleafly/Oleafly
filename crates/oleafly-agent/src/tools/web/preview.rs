use std::time::{Duration, Instant};

use dom_query::Document;
use reqwest::header::CONTENT_TYPE;
use reqwest::Url;
use serde::Serialize;

use super::html::{absolute, decode_body, nesting_depth, MAX_NESTING};
use super::{
    client, deadline_after, fetch_error, mime_of, open_page, read_limited, within, WebClient,
    WebError, WebFetchOptions, WebResult,
};

const PREVIEW_TIMEOUT: Duration = Duration::from_secs(10);
const PREVIEW_MAX_BYTES: usize = 2 * 1024 * 1024;
const MAX_TITLE_CHARS: usize = 300;
const MAX_DESCRIPTION_CHARS: usize = 600;
const MAX_SITE_NAME_CHARS: usize = 120;
const TITLES: &[&str] = &["og:title", "twitter:title"];
const DESCRIPTIONS: &[&str] = &["og:description", "twitter:description", "description"];
const SITE_NAMES: &[&str] = &["og:site_name", "application-name"];
const IMAGES: &[&str] = &[
    "og:image:secure_url",
    "og:image",
    "og:image:url",
    "twitter:image",
    "twitter:image:src",
];
const ICONS: [&[&str]; 2] = [
    &["icon"],
    &["apple-touch-icon", "apple-touch-icon-precomposed"],
];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkPreview {
    pub url: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub site_name: Option<String>,
    pub image: Option<String>,
    pub favicon: Option<String>,
}

fn head_of(html: &str) -> &str {
    html.as_bytes()
        .windows(6)
        .position(|window| window.eq_ignore_ascii_case(b"</head"))
        .map_or(html, |end| &html[..end])
}

fn clean(text: &str, max_chars: usize) -> Option<String> {
    let words = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if words.is_empty() {
        return None;
    }
    if words.chars().count() <= max_chars {
        return Some(words);
    }
    let mut cut: String = words.chars().take(max_chars - 1).collect();
    cut.truncate(cut.trim_end().len());
    cut.push('\u{2026}');
    Some(cut)
}

fn public_url(base: &Url, raw: &str) -> Option<String> {
    let mut url = absolute(base, raw)?;
    if url.scheme() == "http" {
        url.set_scheme("https").ok()?;
    }
    client::check_url(&url).ok()?;
    Some(url.into())
}

fn meta_values(document: &Document, keys: &[&str]) -> Vec<String> {
    keys.iter()
        .flat_map(|key| {
            document
                .select(&format!("meta[property='{key}'], meta[name='{key}']"))
                .nodes()
                .iter()
                .filter_map(|node| node.attr("content").map(|value| value.to_string()))
                .collect::<Vec<_>>()
        })
        .collect()
}

fn first_text(document: &Document, keys: &[&str], max_chars: usize) -> Option<String> {
    meta_values(document, keys)
        .iter()
        .find_map(|value| clean(value, max_chars))
}

fn icon(document: &Document, base: &Url) -> Option<String> {
    let links = document.select("link[rel][href]");
    let links = links.nodes();
    ICONS.iter().find_map(|wanted| {
        links.iter().find_map(|link| {
            let rel = link.attr("rel")?.to_ascii_lowercase();
            if !rel
                .split_ascii_whitespace()
                .any(|token| wanted.contains(&token))
            {
                return None;
            }
            public_url(base, &link.attr("href")?)
        })
    })
}

fn preview_of(html: &str, page_url: &Url) -> LinkPreview {
    let head = head_of(html);
    let document = (nesting_depth(head, MAX_NESTING) <= MAX_NESTING).then(|| Document::from(head));
    let base = document
        .as_ref()
        .and_then(|document| document.select("base[href]").attr("href"))
        .and_then(|href| page_url.join(href.trim()).ok())
        .unwrap_or_else(|| page_url.clone());
    let fallback_icon = || public_url(page_url, "/favicon.ico");
    let Some(document) = document else {
        return LinkPreview {
            url: page_url.to_string(),
            title: None,
            description: None,
            site_name: None,
            image: None,
            favicon: fallback_icon(),
        };
    };
    LinkPreview {
        url: page_url.to_string(),
        title: first_text(&document, TITLES, MAX_TITLE_CHARS)
            .or_else(|| clean(&document.select("title").text(), MAX_TITLE_CHARS)),
        description: first_text(&document, DESCRIPTIONS, MAX_DESCRIPTION_CHARS),
        site_name: first_text(&document, SITE_NAMES, MAX_SITE_NAME_CHARS),
        image: meta_values(&document, IMAGES)
            .iter()
            .find_map(|value| public_url(&base, value)),
        favicon: icon(&document, &base).or_else(fallback_icon),
    }
}

pub async fn link_preview(
    client: &WebClient,
    url: &str,
    user_agent: &str,
) -> WebResult<LinkPreview> {
    let opts = WebFetchOptions {
        user_agent: user_agent.to_string(),
        respect_robots: false,
        timeout: PREVIEW_TIMEOUT,
    };
    let deadline = deadline_after(opts.timeout);
    let response = open_page(client, url, &opts, deadline).await?;
    let page_url = response.url().clone();
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_string);
    if !matches!(
        mime_of(content_type.as_deref()).as_str(),
        "text/html" | "application/xhtml+xml"
    ) {
        return Ok(preview_of("", &page_url));
    }
    let remaining = deadline.saturating_duration_since(Instant::now());
    let (bytes, _) = within(remaining, read_limited(response, PREVIEW_MAX_BYTES))
        .await?
        .map_err(fetch_error)?;
    let text = decode_body(&bytes, content_type.as_deref());
    tokio::task::spawn_blocking(move || preview_of(&text, &page_url))
        .await
        .map_err(|error| WebError::Transport(error.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn open_graph_tags_fill_the_card_with_absolute_public_urls() {
        let html = r#"<!doctype html><html><head>
            <base href="/docs/">
            <title>Fallback title</title>
            <meta property="og:title" content="  The   Paper &amp; Its Data ">
            <meta name="twitter:title" content="Twitter title">
            <meta name="description" content="Plain description">
            <meta property="og:description" content="Open Graph
                description">
            <meta property="og:site_name" content="Example Journal">
            <meta property="og:image" content="cover.png">
            <link rel="apple-touch-icon" href="/touch.png">
            <link rel="Shortcut Icon" href="//cdn.example.org/favicon.png">
            </head><body><meta property="og:title" content="Body title"></body></html>"#;
        let preview = preview_of(html, &page("https://example.org/articles/1"));
        assert_eq!(
            preview,
            LinkPreview {
                url: "https://example.org/articles/1".into(),
                title: Some("The Paper & Its Data".into()),
                description: Some("Open Graph description".into()),
                site_name: Some("Example Journal".into()),
                image: Some("https://example.org/docs/cover.png".into()),
                favicon: Some("https://cdn.example.org/favicon.png".into()),
            }
        );
        let json = serde_json::to_value(&preview).unwrap();
        assert_eq!(json["siteName"], "Example Journal");
        assert!(json.get("site_name").is_none());
    }

    #[test]
    fn a_plain_page_falls_back_to_its_title_description_and_favicon_ico() {
        let html = "<html><head><TITLE>\n Plain page \n</TITLE><meta name=\"description\" content=\"About it\"></HEAD><body><p>x</p></body></html>";
        let preview = preview_of(html, &page("https://plain.example/a/b?c=d"));
        assert_eq!(preview.title.as_deref(), Some("Plain page"));
        assert_eq!(preview.description.as_deref(), Some("About it"));
        assert_eq!(preview.site_name, None);
        assert_eq!(preview.image, None);
        assert_eq!(
            preview.favicon.as_deref(),
            Some("https://plain.example/favicon.ico")
        );
    }

    #[test]
    fn only_public_web_images_are_kept_and_http_ones_are_upgraded() {
        let card = |image: &str| {
            preview_of(
                &format!("<head><meta property=\"og:image\" content=\"{image}\"></head>"),
                &page("https://site.example/post"),
            )
            .image
        };
        assert_eq!(
            card("http://images.example/a.jpg").as_deref(),
            Some("https://images.example/a.jpg")
        );
        for refused in [
            "data:image/png;base64,iVBORw0KGgo=",
            "javascript:alert(1)",
            "file:///etc/passwd",
            "ftp://images.example/a.jpg",
            "https://10.0.0.5/a.jpg",
            "http://127.0.0.1:8080/a.jpg",
            "https://localhost/a.jpg",
            "https://[::1]/a.jpg",
            "https://user:pw@images.example/a.jpg",
            "https://printer.local/a.jpg",
            "",
            "   ",
            "#cover",
        ] {
            assert_eq!(card(refused), None, "{refused}");
        }
        let fallback = preview_of(
            "<head><meta property=\"og:image\" content=\"data:image/png;base64,AA\"><meta name=\"twitter:image\" content=\"/t.png\"></head>",
            &page("https://site.example/post"),
        );
        assert_eq!(
            fallback.image.as_deref(),
            Some("https://site.example/t.png")
        );
        let private_icon = preview_of(
            "<head><link rel=\"icon\" href=\"https://192.168.1.1/i.png\"></head>",
            &page("https://site.example/post"),
        );
        assert_eq!(
            private_icon.favicon.as_deref(),
            Some("https://site.example/favicon.ico")
        );
    }

    #[test]
    fn long_text_is_capped_on_a_character_boundary() {
        let title = "é".repeat(MAX_TITLE_CHARS * 3);
        let description = "word ".repeat(MAX_DESCRIPTION_CHARS);
        let site = "s".repeat(MAX_SITE_NAME_CHARS + 1);
        let preview = preview_of(
            &format!("<head><meta property=\"og:title\" content=\"{title}\"><meta name=\"description\" content=\"{description}\"><meta property=\"og:site_name\" content=\"{site}\"></head>"),
            &page("https://site.example/"),
        );
        let title = preview.title.unwrap();
        assert_eq!(title.chars().count(), MAX_TITLE_CHARS);
        assert!(title.ends_with('\u{2026}'));
        let description = preview.description.unwrap();
        assert!(description.chars().count() <= MAX_DESCRIPTION_CHARS);
        assert!(description.ends_with("word\u{2026}"));
        assert_eq!(
            preview.site_name.unwrap().chars().count(),
            MAX_SITE_NAME_CHARS
        );
    }

    #[test]
    fn a_page_nested_too_deep_is_not_parsed() {
        let html = format!(
            "<head><title>T</title>{}</head>",
            "<div>".repeat(MAX_NESTING + 10)
        );
        let preview = preview_of(&html, &page("https://deep.example/"));
        assert_eq!(preview.title, None);
        assert_eq!(
            preview.favicon.as_deref(),
            Some("https://deep.example/favicon.ico")
        );
    }

    #[tokio::test]
    async fn local_private_and_non_web_addresses_are_refused_before_any_request() {
        let client = WebClient::new("Oleafly/test").unwrap();
        for refused in [
            "http://127.0.0.1:8080/",
            "https://localhost/",
            "http://localhost:1420/",
            "https://192.168.1.1/admin",
            "https://10.0.0.5/",
            "https://169.254.169.254/latest/meta-data/",
            "https://[::1]/",
            "https://[fd00::1]/",
            "https://intranet/",
            "https://printer.local/",
            "https://user:pw@example.com/",
        ] {
            assert!(
                matches!(
                    link_preview(&client, refused, "Oleafly/test").await,
                    Err(WebError::NotAllowed(_))
                ),
                "{refused}"
            );
        }
        for invalid in [
            "ftp://example.com/",
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,hi",
            "not a url",
        ] {
            assert!(
                matches!(
                    link_preview(&client, invalid, "Oleafly/test").await,
                    Err(WebError::InvalidUrl(_))
                ),
                "{invalid}"
            );
        }
    }
}
