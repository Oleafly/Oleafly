//! Reads a post on X for the static card a note keeps (fenced `x-post` block): author, handle,
//! date and text, from X's public oEmbed endpoint. No X script runs in the app; the live post
//! is shown only in the isolated note video page.

use std::sync::OnceLock;
use std::time::Duration;

use oleafly_agent::tools::web::public_https_client;
use reqwest::Url;
use serde::{Deserialize, Serialize};

use crate::agent::web::WEB_USER_AGENT;

const OEMBED: &str = "https://publish.x.com/oembed";
const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_BYTES: usize = 256 * 1024;
const MAX_TEXT: usize = 4_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteXPost {
    pub url: String,
    pub id: String,
    pub author: String,
    pub handle: String,
    pub date: String,
    pub text: String,
}

#[derive(Deserialize)]
struct OEmbed {
    author_name: String,
    author_url: String,
    html: String,
}

static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

fn client() -> Result<&'static reqwest::Client, String> {
    if let Some(client) = CLIENT.get() {
        return Ok(client);
    }
    let client = public_https_client(WEB_USER_AGENT, TIMEOUT).map_err(|error| error.to_string())?;
    Ok(CLIENT.get_or_init(|| client))
}

/// The canonical address and id of a post on X or Twitter, or `None` for any other link.
pub fn post_of(link: &str) -> Option<(String, String)> {
    let url = Url::parse(link.trim()).ok()?;
    if url.scheme() != "https" {
        return None;
    }
    let host = url.host_str()?.to_ascii_lowercase();
    let host = host
        .strip_prefix("www.")
        .or_else(|| host.strip_prefix("mobile."))
        .unwrap_or(&host);
    if host != "x.com" && host != "twitter.com" {
        return None;
    }
    let parts: Vec<&str> = url
        .path_segments()?
        .filter(|part| !part.is_empty())
        .collect();
    let (user, id) = match parts.as_slice() {
        [user, "status" | "statuses", id, ..] => (*user, *id),
        _ => return None,
    };
    let user_ok = !user.is_empty()
        && user.len() <= 15
        && user.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    let id_ok = !id.is_empty() && id.len() <= 20 && id.chars().all(|c| c.is_ascii_digit());
    (user_ok && id_ok).then(|| (format!("https://x.com/{user}/status/{id}"), id.to_string()))
}

fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('&') {
        out.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest[..rest.len().min(12)].find(';') else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let decoded = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" | "#39" => Some('\''),
            "nbsp" => Some(' '),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            "hellip" => Some('…'),
            _ => entity
                .strip_prefix("#x")
                .or_else(|| entity.strip_prefix("#X"))
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| {
                    entity
                        .strip_prefix('#')
                        .and_then(|dec| dec.parse::<u32>().ok())
                })
                .and_then(char::from_u32),
        };
        match decoded {
            Some(character) => {
                out.push(character);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn strip_tags(html: &str) -> String {
    let with_breaks = html
        .replace("<br>", "\n")
        .replace("<br/>", "\n")
        .replace("<br />", "\n");
    let mut out = String::with_capacity(with_breaks.len());
    let mut in_tag = false;
    for character in with_breaks.chars() {
        match character {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => out.push(character),
            _ => {}
        }
    }
    decode_entities(&out)
}

fn clean(text: &str) -> String {
    let lines: Vec<String> = text
        .lines()
        .map(|line| line.split_whitespace().collect::<Vec<_>>().join(" "))
        .collect();
    let joined = lines.join("\n").trim().to_string();
    if joined.chars().count() <= MAX_TEXT {
        return joined;
    }
    joined.chars().take(MAX_TEXT).collect::<String>() + "…"
}

/// The post's text and date from oEmbed's blockquote: `<p …>text</p>&mdash; Name (@handle) <a …>date</a>`.
fn text_and_date(html: &str) -> (String, String) {
    let text = html
        .find("<p")
        .and_then(|start| html[start..].find('>').map(|open| start + open + 1))
        .and_then(|from| html[from..].find("</p>").map(|end| &html[from..from + end]))
        .map(|inner| clean(&strip_tags(inner)))
        .unwrap_or_default();
    let date = html
        .rfind("<a")
        .and_then(|start| html[start..].find('>').map(|open| start + open + 1))
        .and_then(|from| html[from..].find("</a>").map(|end| &html[from..from + end]))
        .map(|inner| clean(&strip_tags(inner)))
        .unwrap_or_default();
    (text, date)
}

fn handle_of(author_url: &str) -> String {
    Url::parse(author_url)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|mut parts| parts.find(|part| !part.is_empty()).map(str::to_string))
        })
        .filter(|handle| {
            handle
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_')
        })
        .unwrap_or_default()
}

fn post_from(url: String, id: String, embed: OEmbed) -> NoteXPost {
    let (text, date) = text_and_date(&embed.html);
    NoteXPost {
        url,
        id,
        author: clean(&decode_entities(&embed.author_name)),
        handle: handle_of(&embed.author_url),
        date,
        text,
    }
}

#[tauri::command]
pub async fn note_x_post(url: String) -> Result<NoteXPost, String> {
    let (canonical, id) =
        post_of(&url).ok_or_else(|| "This is not a link to a post on X.".to_string())?;
    let mut query = Url::parse(OEMBED).map_err(|error| error.to_string())?;
    query
        .query_pairs_mut()
        .append_pair("url", &canonical)
        .append_pair("omit_script", "true")
        .append_pair("dnt", "true");
    let response = client()?
        .get(query)
        .send()
        .await
        .map_err(|error| format!("X did not answer: {error}"))?;
    if !response.status().is_success() {
        return Err(format!(
            "X could not show this post ({}).",
            response.status()
        ));
    }
    let body = response.bytes().await.map_err(|error| error.to_string())?;
    if body.len() > MAX_BYTES {
        return Err("X sent more than a post.".to_string());
    }
    let embed: OEmbed = serde_json::from_slice(&body)
        .map_err(|error| format!("X sent something unexpected: {error}"))?;
    Ok(post_from(canonical, id, embed))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_links_to_posts_on_x_and_twitter_only() {
        let canonical = || Some(("https://x.com/jack/status/20".to_string(), "20".to_string()));
        assert_eq!(post_of("https://x.com/jack/status/20"), canonical());
        assert_eq!(
            post_of(" https://twitter.com/jack/status/20?s=46&t=abc "),
            canonical()
        );
        assert_eq!(
            post_of("https://mobile.twitter.com/jack/status/20/photo/1"),
            canonical()
        );
        assert_eq!(post_of("https://www.x.com/jack/statuses/20"), canonical());
        for refused in [
            "http://x.com/jack/status/20",
            "https://x.com/jack",
            "https://x.com/jack/status/abc",
            "https://evil.com/jack/status/20",
            "https://x.com.evil.com/jack/status/20",
            "https://x.com/ja-ck/status/20",
            "https://x.com/jack/status/123456789012345678901",
            "not a url",
        ] {
            assert_eq!(post_of(refused), None, "{refused}");
        }
    }

    #[test]
    fn reads_the_text_date_author_and_handle_from_the_oembed_blockquote() {
        let embed = OEmbed {
            author_name: "Jack &amp; Co".into(),
            author_url: "https://x.com/jack".into(),
            html: concat!(
                "<blockquote class=\"twitter-tweet\" data-dnt=\"true\"><p lang=\"en\" dir=\"ltr\">just setting up my ",
                "<a href=\"https://t.co/x\">twttr</a> &amp; more<br>second   line &#x1F600;</p>",
                "&mdash; jack (@jack) <a href=\"https://x.com/jack/status/20?ref_src=twsrc%5Etfw\">March 21, 2006</a>",
                "</blockquote>\n"
            )
            .into(),
        };
        let post = post_from("https://x.com/jack/status/20".into(), "20".into(), embed);
        assert_eq!(
            post,
            NoteXPost {
                url: "https://x.com/jack/status/20".into(),
                id: "20".into(),
                author: "Jack & Co".into(),
                handle: "jack".into(),
                date: "March 21, 2006".into(),
                text: "just setting up my twttr & more\nsecond line 😀".into(),
            }
        );
    }

    #[test]
    fn leaves_unknown_entities_and_stray_ampersands_alone() {
        assert_eq!(
            decode_entities("a & b &unknown; &#60;c&#62; &"),
            "a & b &unknown; <c> &"
        );
    }

    #[test]
    fn caps_a_long_post() {
        let long = "word ".repeat(2_000);
        let capped = clean(&long);
        assert_eq!(capped.chars().count(), MAX_TEXT + 1);
        assert!(capped.ends_with('…'));
    }

    #[test]
    fn keeps_a_handle_only_when_it_looks_like_one() {
        assert_eq!(handle_of("https://twitter.com/jack"), "jack");
        assert_eq!(handle_of("https://twitter.com/ja<ck"), "");
        assert_eq!(handle_of("not a url"), "");
    }

    #[tokio::test]
    async fn refuses_anything_but_a_post_link_before_going_online() {
        let error = note_x_post("https://example.org/a".into())
            .await
            .unwrap_err();
        assert_eq!(error, "This is not a link to a post on X.");
    }
}
