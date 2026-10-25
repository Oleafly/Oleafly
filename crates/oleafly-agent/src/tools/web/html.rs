//! A page's readable part as Markdown: page chrome and scripts removed,
//! links made absolute, the text decoded from the page's own charset.
//!
//! A page nested deeper than `MAX_NESTING` is never parsed: the parser
//! slows down with the square of the depth, and the Markdown writer
//! recurses once per nested list, quote or table, so a page of repeated
//! `<ul><li>` could stop a core for minutes or overflow the stack. Such a
//! page is read as plain text by a scan that keeps no stack.
use dom_query::{Document, NodeRef};
use reqwest::Url;

const MAX_LINKS: usize = 200;
/// How deep elements may nest before a page is read as plain text.
pub(crate) const MAX_NESTING: usize = 512;
/// Elements that have no end tag or whose end tag may be left out, so
/// repeating them does not nest.
const UNNESTED: &[&str] = &[
    "area", "base", "basefont", "bgsound", "br", "col", "embed", "frame", "hr", "image", "img",
    "input", "keygen", "link", "meta", "param", "source", "track", "wbr", "p", "li", "dt", "dd",
    "option", "optgroup", "tr", "td", "th", "thead", "tbody", "tfoot", "rb", "rt", "rtc", "rp",
    "colgroup", "caption", "html", "head", "body",
];
/// Elements whose content is text up to their end tag.
const RAW_TEXT: &[&str] = &[
    "script",
    "style",
    "textarea",
    "title",
    "xmp",
    "iframe",
    "noembed",
    "noframes",
    "noscript",
    "plaintext",
];
/// Raw-text elements whose content is not part of the page's text.
const HIDDEN_TEXT: &[&str] = &[
    "script", "style", "noscript", "iframe", "noembed", "noframes", "title",
];
/// HTML elements that end SVG or MathML content when they start in it.
const BREAKOUT: &[&str] = &[
    "b",
    "big",
    "blockquote",
    "body",
    "br",
    "center",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "embed",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "head",
    "hr",
    "i",
    "img",
    "li",
    "listing",
    "menu",
    "meta",
    "nobr",
    "ol",
    "p",
    "pre",
    "ruby",
    "s",
    "small",
    "span",
    "strong",
    "strike",
    "sub",
    "sup",
    "table",
    "tt",
    "u",
    "ul",
    "var",
];
/// Elements the Markdown writer handles by recursing.
const RECURSIVE: &[&str] = &["ul", "ol", "blockquote", "table"];
/// Elements that end a line in the plain-text reading.
const LINE_BREAKING: &[&str] = &[
    "address",
    "article",
    "aside",
    "blockquote",
    "br",
    "dd",
    "div",
    "dl",
    "dt",
    "figcaption",
    "figure",
    "footer",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "hr",
    "li",
    "main",
    "nav",
    "ol",
    "p",
    "pre",
    "section",
    "table",
    "tr",
    "ul",
];

fn named(list: &[&str], name: &[u8]) -> bool {
    list.iter()
        .any(|entry| entry.as_bytes().eq_ignore_ascii_case(name))
}

/// One tag found by `scan_tags`.
struct Tag<'a> {
    name: &'a [u8],
    closing: bool,
    self_closing: bool,
}

/// What the `<` at some offset starts.
enum Markup<'a> {
    /// A comment, doctype or processing instruction; `end` is the offset
    /// just past it.
    Skipped { end: usize },
    /// A `<` that starts no markup.
    Stray,
    /// A tag; `end` is the offset of its closing `>` (or the end of the
    /// input when it never closes).
    Tag { tag: Tag<'a>, end: usize },
}

/// Reads the markup that starts at the `<` at offset `start` of `html`.
fn markup_at(html: &str, start: usize) -> Markup<'_> {
    let bytes = html.as_bytes();
    if bytes[start + 1..].starts_with(b"!--") {
        let end = html[start + 4..]
            .find("-->")
            .map_or(bytes.len(), |end| start + 4 + end + 3);
        return Markup::Skipped { end };
    }
    let closing = bytes.get(start + 1) == Some(&b'/');
    let name_start = start + 1 + usize::from(closing);
    let name_end = bytes[name_start..]
        .iter()
        .position(|byte| !byte.is_ascii_alphanumeric())
        .map_or(bytes.len(), |end| name_start + end);
    if name_end == name_start || !bytes[name_start].is_ascii_alphabetic() {
        if bytes
            .get(name_start)
            .is_some_and(|byte| matches!(byte, b'!' | b'?'))
        {
            // A doctype or processing instruction.
            let end = bytes[start..]
                .iter()
                .position(|byte| *byte == b'>')
                .map_or(bytes.len(), |end| start + end + 1);
            return Markup::Skipped { end };
        }
        return Markup::Stray;
    }
    let end = bytes[name_end..]
        .iter()
        .position(|byte| *byte == b'>')
        .map_or(bytes.len(), |end| name_end + end);
    let tag = Tag {
        name: &bytes[name_start..name_end],
        closing,
        self_closing: end > name_end && bytes[end - 1] == b'/',
    };
    Markup::Tag { tag, end }
}

/// Where the content of the raw-text element `name` ends: the start of its
/// end tag at or after `from`, or the end of `html` when it never closes.
fn raw_text_end(html: &str, from: usize, name: &[u8]) -> usize {
    let bytes = html.as_bytes();
    let mut search = from;
    loop {
        let Some(found) = html[search..].find("</") else {
            return bytes.len();
        };
        let close = search + found;
        let after = close + 2;
        if bytes
            .get(after..after + name.len())
            .is_some_and(|candidate| candidate.eq_ignore_ascii_case(name))
        {
            return close;
        }
        search = after;
    }
}

/// Walks the tags of `html` in order without building anything: comments,
/// doctypes and stray `<` are skipped, and the content of raw-text elements
/// (scripts, styles) is passed over in one step. `visit` gets each tag and
/// the text before it; returning false stops the walk.
fn scan_tags<'a>(html: &'a str, mut visit: impl FnMut(&'a str, Option<Tag<'a>>) -> bool) {
    let bytes = html.as_bytes();
    let mut text_from = 0usize;
    let mut at = 0usize;
    while let Some(offset) = bytes[at..].iter().position(|byte| *byte == b'<') {
        let start = at + offset;
        match markup_at(html, start) {
            Markup::Stray => at = start + 1,
            Markup::Skipped { end } => {
                if !visit(&html[text_from..start], None) {
                    return;
                }
                text_from = end;
                at = end;
            }
            Markup::Tag { tag, end } => {
                let (name, closing) = (tag.name, tag.closing);
                if !visit(&html[text_from..start], Some(tag)) {
                    return;
                }
                at = (end + 1).min(bytes.len());
                text_from = at;
                if !closing && named(RAW_TEXT, name) {
                    // Skip to the element's end tag; its content is never markup.
                    let content_end = raw_text_end(html, at, name);
                    if !visit(&html[at..content_end], None) {
                        return;
                    }
                    at = content_end;
                    text_from = content_end;
                }
            }
        }
    }
    visit(&html[text_from..], None);
}

/// How deep the elements of `html` nest, read from its tags alone, counted
/// up to just past `limit`. An end tag closes the nearest open element of
/// its name and is ignored when none is open, as the parser does; inside
/// SVG or MathML a self-closed tag does not nest.
pub(crate) fn nesting_depth(html: &str, limit: usize) -> usize {
    let mut open: Vec<&[u8]> = Vec::new();
    let mut foreign = 0usize;
    let mut deepest = 0usize;
    scan_tags(html, |_, tag| {
        let Some(tag) = tag else {
            return true;
        };
        if tag.closing {
            if let Some(at) = open
                .iter()
                .rposition(|name| name.eq_ignore_ascii_case(tag.name))
            {
                open.truncate(at);
                if open.len() < foreign {
                    foreign = 0;
                }
            }
            return true;
        }
        if foreign > 0 && named(BREAKOUT, tag.name) {
            // The parser leaves the SVG or MathML content here.
            open.truncate(foreign - 1);
            foreign = 0;
        }
        let starts_foreign = named(&["svg", "math"], tag.name);
        if named(UNNESTED, tag.name) || ((foreign > 0 || starts_foreign) && tag.self_closing) {
            return true;
        }
        if starts_foreign && foreign == 0 {
            foreign = open.len() + 1;
        }
        open.push(tag.name);
        deepest = deepest.max(open.len());
        deepest <= limit
    });
    deepest
}

/// The most recursive Markdown elements on one path below `node`.
fn markdown_depth(node: &NodeRef) -> usize {
    let mut deepest = 0usize;
    let mut pending = vec![(*node, 0usize)];
    while let Some((node, depth)) = pending.pop() {
        let depth = depth + usize::from(RECURSIVE.iter().any(|name| node.has_name(name)));
        deepest = deepest.max(depth);
        pending.extend(node.children_it(false).map(|child| (child, depth)));
    }
    deepest
}

/// Character references in plain text, the common ones decoded.
fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let candidate = &rest[at..];
        let end = candidate.find(';').filter(|end| *end <= 10);
        let decoded = end.and_then(|end| {
            let name = &candidate[1..end];
            let character = match name {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ => name
                    .strip_prefix("#x")
                    .or_else(|| name.strip_prefix("#X"))
                    .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                    .or_else(|| name.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                    .and_then(char::from_u32),
            }?;
            Some((character, end + 1))
        });
        match decoded {
            Some((character, length)) => {
                out.push(character);
                rest = &candidate[length..];
            }
            None => {
                out.push('&');
                rest = &candidate[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// A page read as plain text without parsing it: tags dropped, scripts and
/// styles left out, block elements ending lines.
pub(crate) fn flatten(html: &str) -> Extracted {
    let mut text = String::with_capacity(html.len() / 2);
    let mut title: Option<String> = None;
    let mut in_title = false;
    let mut hidden = false;
    scan_tags(html, |before, tag| {
        if in_title && title.is_none() {
            let words = decode_entities(before);
            title = Some(words.split_whitespace().collect::<Vec<_>>().join(" "))
                .filter(|title| !title.is_empty());
        } else if !hidden {
            let words = decode_entities(before);
            let mut first = true;
            for word in words.split_whitespace() {
                if !first || !text.ends_with(['\n', ' ']) && !text.is_empty() {
                    text.push(' ');
                }
                text.push_str(word);
                first = false;
            }
        }
        in_title = false;
        hidden = false;
        if let Some(tag) = tag {
            if !tag.closing {
                in_title = tag.name.eq_ignore_ascii_case(b"title");
                hidden = named(HIDDEN_TEXT, tag.name);
            }
            if named(LINE_BREAKING, tag.name) && !text.ends_with("\n\n") && !text.is_empty() {
                text.push('\n');
            }
        }
        true
    });
    Extracted {
        title,
        markdown: collapse_blank_lines(&text),
        links: Vec::new(),
    }
}
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

/// The readable content of an HTML page; a page nested deeper than
/// `MAX_NESTING` as plain text.
pub(crate) fn extract(html: &str, page_url: &Url) -> Extracted {
    if nesting_depth(html, MAX_NESTING) > MAX_NESTING {
        return flatten(html);
    }
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
    let node = root
        .as_ref()
        .and_then(|selection| selection.nodes().first().copied())
        .unwrap_or_else(|| document.root());
    // The tag count above can differ from the tree the parser built; the
    // writer recurses per level, so a tree that still nests too deep is read
    // as text, which walks it without recursing.
    let markdown = if markdown_depth(&node) > MAX_NESTING {
        node.text().to_string()
    } else {
        node.md(None).to_string()
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
    fn a_page_of_deeply_nested_lists_is_read_as_text_without_parsing() {
        let depth = 100_000;
        let page = format!(
            "<html><head><title>Deep</title></head><body>{}leaf{}</body></html>",
            "<ul><li>".repeat(depth),
            "</li></ul>".repeat(depth)
        );
        assert!(nesting_depth(&page, MAX_NESTING) > MAX_NESTING);
        let started = std::time::Instant::now();
        let extracted = extract(&page, &Url::parse("https://site.org/").unwrap());
        assert!(started.elapsed() < std::time::Duration::from_secs(10));
        assert_eq!(extracted.markdown, "leaf");
        assert_eq!(extracted.title.as_deref(), Some("Deep"));
        assert!(extracted.links.is_empty());
    }

    #[test]
    fn nesting_is_counted_the_way_the_parser_nests() {
        // The parser ignores an end tag with nothing open to close.
        let stray = "<ul></div><blockquote></span>".repeat(300);
        assert!(nesting_depth(&stray, MAX_NESTING) > MAX_NESTING);
        // Paragraphs, list items and void elements do not nest; SVG shapes
        // close themselves.
        let flat = format!(
            "<div>{}<svg>{}</svg></div>",
            "<p>a<li>b<br><img src=x>".repeat(2_000),
            "<path d='M0'/>".repeat(2_000)
        );
        assert!(nesting_depth(&flat, MAX_NESTING) < 10);
        // An HTML element ends the SVG content, so `<ul/>` nests again.
        let breakout = format!("<svg>{}", "<ul/>".repeat(600));
        assert!(nesting_depth(&breakout, MAX_NESTING) > MAX_NESTING);
        // Markup inside a script or a comment is text.
        let hidden = format!(
            "<script>{}</script><!-- {} -->",
            "<ul>".repeat(2_000),
            "<ul>".repeat(2_000)
        );
        assert_eq!(nesting_depth(&hidden, MAX_NESTING), 1);
        // Closed elements unwind.
        assert_eq!(
            nesting_depth(&"<div><ul><li>x</li></ul></div>".repeat(1_000), MAX_NESTING),
            2
        );
    }

    #[test]
    fn ordinary_nested_lists_still_become_markdown() {
        let extracted = extract(
            "<body><ul><li>a<ul><li>b</li></ul></li></ul></body>",
            &Url::parse("https://site.org/").unwrap(),
        );
        assert!(extracted.markdown.contains("- a"), "{}", extracted.markdown);
        assert!(extracted.markdown.contains("- b"), "{}", extracted.markdown);
    }

    #[test]
    fn the_markdown_depth_of_a_tree_counts_lists_quotes_and_tables() {
        let document = Document::from(
            "<body><ul><li><blockquote><table><tr><td><ol><li>x</li></ol></td></tr></table></blockquote></li></ul><p>y</p></body>",
        );
        assert_eq!(markdown_depth(&document.root()), 4);
    }

    #[test]
    fn the_plain_text_reading_drops_tags_scripts_and_entities() {
        let flat = flatten(
            "<html><head><title>A &amp; B</title><style>p{}</style></head><body><h1>Head</h1><p>One&nbsp;two &lt;3&gt; &#x263A;</p><script>evil()</script><p>Three</p></body></html>",
        );
        assert_eq!(flat.title.as_deref(), Some("A & B"));
        assert!(flat.markdown.starts_with("Head"), "{}", flat.markdown);
        assert!(
            flat.markdown.contains("One two <3> \u{263a}"),
            "{}",
            flat.markdown
        );
        assert!(flat.markdown.contains("Three"));
        assert!(!flat.markdown.contains("evil") && !flat.markdown.contains("p{}"));
    }

    #[test]
    fn long_runs_of_blank_lines_are_collapsed() {
        assert_eq!(collapse_blank_lines("a\n\n\n\nb\n"), "a\n\nb");
    }
}
