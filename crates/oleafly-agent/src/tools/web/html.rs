//! A page's readable part as Markdown: page chrome and scripts removed,
//! links made absolute, the text decoded from the page's own charset.
use dom_query::Document;
use reqwest::Url;

const MAX_LINKS: usize = 200;
const DROPPED: &str = "script, style, noscript, template, iframe, svg, canvas, form, button, nav, footer, header, aside, [hidden], [aria-hidden=true]";
const ROOTS: [&str; 6] = [
    "article",
    "main",
    "[role=main]",
    "#content",
    ".content",
    "body",
];

pub(crate) struct Extracted {
    pub title: Option<String>,
    pub markdown: String,
    pub links: Vec<String>,
}

fn collapse_blank_lines(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut newlines = 0usize;
    for character in text.chars() {
        if character == '\n' {
            newlines += 1;
            if newlines <= 2 {
                out.push('\n');
            }
        } else {
            newlines = 0;
            out.push(character);
        }
    }
    out.trim().to_string()
}

fn absolute(base: &Url, raw: &str) -> Option<Url> {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('#') || raw.starts_with("javascript:") {
        return None;
    }
    base.join(raw).ok()
}

/// The readable content of an HTML page.
pub(crate) fn extract(html: &str, page_url: &Url) -> Extracted {
    let document = Document::from(html);
    let title = document
        .select("meta[property='og:title'], meta[name='og:title']")
        .attr("content")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            Some(document.select("title").text().trim().to_string()).filter(|text| !text.is_empty())
        });
    let base = document
        .select("base[href]")
        .attr("href")
        .and_then(|href| page_url.join(href.trim()).ok())
        .unwrap_or_else(|| page_url.clone());

    document.select(DROPPED).remove();

    let mut links: Vec<String> = Vec::new();
    for node in document.select("a[href]").nodes() {
        let Some(href) = node.attr("href") else {
            continue;
        };
        if let Some(url) = absolute(&base, &href) {
            node.set_attr("href", url.as_str());
            if url.scheme() == "https" && links.len() < MAX_LINKS {
                let link = url.to_string();
                if !links.contains(&link) {
                    links.push(link);
                }
            }
        }
    }
    for node in document.select("img[src]").nodes() {
        if let Some(src) = node.attr("src") {
            if let Some(url) = absolute(&base, &src) {
                node.set_attr("src", url.as_str());
            }
        }
    }

    let root = ROOTS
        .iter()
        .map(|selector| document.select(selector))
        .find(|selection| selection.exists());
    let markdown = match root
        .as_ref()
        .and_then(|selection| selection.nodes().first())
    {
        Some(node) => node.md(None).to_string(),
        None => document.root().md(None).to_string(),
    };
    Extracted {
        title,
        markdown: collapse_blank_lines(&markdown),
        links,
    }
}

fn charset_from_content_type(content_type: Option<&str>) -> Option<&'static encoding_rs::Encoding> {
    let content_type = content_type?;
    content_type
        .split(';')
        .skip(1)
        .filter_map(|parameter| parameter.split_once('='))
        .find(|(name, _)| name.trim().eq_ignore_ascii_case("charset"))
        .and_then(|(_, value)| {
            encoding_rs::Encoding::for_label(value.trim().trim_matches('"').as_bytes())
        })
}

/// A `<meta charset>` or `http-equiv` charset in the first kilobyte.
fn charset_from_meta(bytes: &[u8]) -> Option<&'static encoding_rs::Encoding> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]).to_ascii_lowercase();
    let at = head.find("charset=")?;
    let rest = head[at + "charset=".len()..].trim_start_matches(['"', '\'']);
    let label: String = rest
        .chars()
        .take_while(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | ':' | '.')
        })
        .collect();
    encoding_rs::Encoding::for_label(label.as_bytes())
}

/// The body as text, decoded from its declared charset, else a charset in
/// the page's head, else UTF-8 (invalid bytes replaced).
pub(crate) fn decode_body(bytes: &[u8], content_type: Option<&str>) -> String {
    let encoding = charset_from_content_type(content_type)
        .or_else(|| charset_from_meta(bytes))
        .unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    text.into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extraction_prefers_the_main_article_and_drops_page_chrome() {
        let page = r#"<html><head><title>T</title><base href="https://site.org/docs/"></head><body><nav>Menu</nav><article><h1>Heading</h1><p>Body &amp; more <a href="next.html">next</a></p><script>evil()</script></article><footer>Foot</footer></body></html>"#;
        let extracted = extract(page, &Url::parse("https://site.org/docs/page").unwrap());
        assert_eq!(extracted.title.as_deref(), Some("T"));
        assert!(
            extracted.markdown.contains("Heading"),
            "{}",
            extracted.markdown
        );
        assert!(
            extracted.markdown.contains("Body & more"),
            "{}",
            extracted.markdown
        );
        assert!(
            extracted
                .markdown
                .contains("https://site.org/docs/next.html"),
            "{}",
            extracted.markdown
        );
        assert!(!extracted.markdown.contains("Menu"));
        assert!(!extracted.markdown.contains("evil"));
        assert!(!extracted.markdown.contains("Foot"));
        assert_eq!(
            extracted.links,
            vec!["https://site.org/docs/next.html".to_string()]
        );
    }

    #[test]
    fn the_open_graph_title_wins_over_the_title_tag() {
        let page = r#"<html><head><title>Site | Page</title><meta property="og:title" content="Page"></head><body><p>x</p></body></html>"#;
        let extracted = extract(page, &Url::parse("https://site.org/").unwrap());
        assert_eq!(extracted.title.as_deref(), Some("Page"));
    }

    #[test]
    fn bodies_are_decoded_from_their_declared_charset() {
        let (bytes, _, _) =
            encoding_rs::SHIFT_JIS.encode("<meta charset=\"shift_jis\"><p>日本語</p>");
        assert!(decode_body(&bytes, Some("text/html")).contains("日本語"));
        let (latin, _, _) = encoding_rs::WINDOWS_1252.encode("café");
        assert_eq!(
            decode_body(&latin, Some("text/plain; charset=windows-1252")),
            "café"
        );
        assert_eq!(decode_body("plain".as_bytes(), None), "plain");
    }

    #[test]
    fn long_runs_of_blank_lines_are_collapsed() {
        assert_eq!(collapse_blank_lines("a\n\n\n\nb\n"), "a\n\nb");
    }
}
