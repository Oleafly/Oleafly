use std::borrow::Cow;
use std::collections::HashSet;
use std::sync::LazyLock;

use ammonia::{Builder, UrlRelative};
use axum::http::StatusCode;
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::crypto::sha256_b64url;
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::page::escape;
use oleafly_collab_protocol::published::{
    AdminPublishedNote, PublishedNote, MAX_PAGES_PER_ACCOUNT, MAX_SOURCE_CHARS, MAX_TITLE_CHARS,
    PUBLIC_PATH,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use url::Url;

use crate::db::parse_id;
use crate::error::ServerError;
use crate::projects;
use crate::quotas::{self, Storage};
use crate::rate_limit::RateLimiter;
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::tokens;

pub const PAGE_BURST: u32 = 120;
pub const PAGES_PER_MINUTE: u32 = 120;
pub const PUBLISH_BURST: u32 = 10;
pub const PUBLISHES_PER_MINUTE: u32 = 10;
const SLUG_CHARS: usize = 16;
pub const ADMIN_LIST_LIMIT: u32 = 1000;

const IMAGE_TYPES: [&str; 5] = ["png", "jpeg", "gif", "webp", "svg+xml"];

const MATHML_TAGS: [&str; 30] = [
    "math",
    "semantics",
    "mrow",
    "mi",
    "mo",
    "mn",
    "ms",
    "mtext",
    "mspace",
    "msub",
    "msup",
    "msubsup",
    "mfrac",
    "msqrt",
    "mroot",
    "mover",
    "munder",
    "munderover",
    "mtable",
    "mtr",
    "mtd",
    "mlabeledtr",
    "mstyle",
    "mpadded",
    "mphantom",
    "menclose",
    "merror",
    "mmultiscripts",
    "mprescripts",
    "none",
];

const MATHML_ATTRIBUTES: [&str; 31] = [
    "display",
    "displaystyle",
    "scriptlevel",
    "mathvariant",
    "fence",
    "separator",
    "stretchy",
    "symmetric",
    "largeop",
    "movablelimits",
    "form",
    "lspace",
    "rspace",
    "minsize",
    "maxsize",
    "accent",
    "accentunder",
    "linethickness",
    "notation",
    "columnalign",
    "rowalign",
    "columnspacing",
    "rowspacing",
    "columnlines",
    "rowlines",
    "columnspan",
    "rowspan",
    "frame",
    "depth",
    "voffset",
    "width",
];

const NOTE_STYLE: &str = concat!(
    "*{box-sizing:border-box}",
    "html{-webkit-text-size-adjust:100%}",
    "body{margin:0;padding:3rem 1.25rem 4rem;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;",
    "font-size:1.0625rem;line-height:1.65;color:#18181b;background:#ffffff}",
    ".note{max-width:46rem;margin:0 auto;overflow-wrap:break-word}",
    ".note>header{margin-bottom:2rem;padding-bottom:1rem;border-bottom:1px solid #e4e4e7}",
    ".note>header h1{margin:0;font-size:2rem;line-height:1.25;letter-spacing:-0.015em}",
    ".note>header time{display:block;margin-top:0.5rem;font-size:0.875rem;color:#71717a}",
    "h1,h2,h3,h4,h5,h6{line-height:1.3;margin:2rem 0 0.75rem}",
    "p,ul,ol,dl,blockquote,pre,table,figure,details{margin:0 0 1rem}",
    "a{color:#2563eb;text-underline-offset:2px}",
    "img{max-width:100%;height:auto}",
    "figure{margin-left:0;margin-right:0;text-align:center}",
    "figcaption{font-size:0.875rem;color:#52525b}",
    "blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #d4d4d8;color:#3f3f46}",
    "code,kbd,samp{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:0.9em}",
    ":not(pre)>code{padding:0.1em 0.3em;border-radius:0.25rem;background:#f4f4f5}",
    "pre{overflow-x:auto;padding:0.875rem 1rem;border-radius:0.5rem;background:#f4f4f5;line-height:1.5}",
    "pre a{display:none}",
    "table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse}",
    "th,td{padding:0.375rem 0.75rem;border:1px solid #e4e4e7}",
    "th{background:#fafafa}",
    "hr{border:0;border-top:1px solid #e4e4e7;margin:2rem 0}",
    "mark{background:#fef08a}",
    "math[display=block]{overflow-x:auto;overflow-y:hidden;margin:1rem 0}",
    ".footnotes{font-size:0.9rem;color:#3f3f46}",
    ".task-list{list-style:none;padding-left:0.25rem}",
    ".foot{max-width:46rem;margin:3rem auto 0;padding-top:1rem;border-top:1px solid #e4e4e7;font-size:0.8125rem;color:#71717a}",
    "@media (prefers-color-scheme:dark){",
    "body{color:#f4f4f5;background:#121317}",
    ".note>header,hr,.foot{border-color:rgba(255,255,255,0.12)}",
    ".note>header time,.foot{color:#a1a1aa}",
    "a{color:#60a5fa}",
    "figcaption,.footnotes,blockquote{color:#d4d4d8}",
    "blockquote{border-left-color:#52525b}",
    ":not(pre)>code,pre{background:#23242a}",
    "th,td{border-color:rgba(255,255,255,0.14)}",
    "th{background:#1b1c21}",
    "mark{background:#854d0e;color:#fefce8}",
    "img{background:#ffffff;border-radius:0.25rem}",
    "}",
);

pub struct Limits {
    pub pages: RateLimiter,
    pub publishes: RateLimiter,
}

impl Default for Limits {
    fn default() -> Limits {
        Limits {
            pages: RateLimiter::new(PAGE_BURST, PAGES_PER_MINUTE),
            publishes: RateLimiter::new(PUBLISH_BURST, PUBLISHES_PER_MINUTE),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Upload {
    pub source: String,
    pub title: String,
    pub html: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Page {
    pub title: String,
    pub html: String,
    pub etag: String,
    pub updated_at: i64,
}

fn image_source(value: &str) -> bool {
    let Some(rest) = value
        .get(..11)
        .filter(|start| start.eq_ignore_ascii_case("data:image/"))
        .map(|_| &value[11..])
    else {
        return false;
    };
    IMAGE_TYPES.iter().any(|kind| {
        rest.get(..kind.len())
            .is_some_and(|start| start.eq_ignore_ascii_case(kind))
            && matches!(rest.as_bytes().get(kind.len()), Some(b';' | b','))
    })
}

fn data_link(value: &str) -> bool {
    value
        .trim_start()
        .get(..5)
        .is_some_and(|start| start.eq_ignore_ascii_case("data:"))
}

fn image_width(style: &str) -> Option<Cow<'static, str>> {
    style.split(';').find_map(|declaration| {
        let (name, value) = declaration.split_once(':')?;
        if !name.trim().eq_ignore_ascii_case("width") {
            return None;
        }
        let value = value.trim();
        let (number, unit) = value
            .strip_suffix('%')
            .map(|number| (number, "%"))
            .or_else(|| value.strip_suffix("px").map(|number| (number, "px")))?;
        (number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
            && number
                .parse::<f64>()
                .is_ok_and(|size| size.is_finite() && size > 0.0))
        .then(|| Cow::Owned(format!("width:{number}{unit}")))
    })
}

fn fragment_only(url: &str) -> Option<Cow<'_, str>> {
    url.starts_with('#').then_some(Cow::Borrowed(url))
}

fn sanitizer() -> &'static Builder<'static> {
    static SANITIZER: LazyLock<Builder<'static>> = LazyLock::new(|| {
        let mut builder = Builder::default();
        builder
            .rm_tags(["area", "map"])
            .add_tags(["section"])
            .add_tags(MATHML_TAGS)
            .add_clean_content_tags([
                "annotation",
                "annotation-xml",
                "iframe",
                "noscript",
                "object",
                "select",
                "svg",
                "template",
                "textarea",
                "title",
            ])
            .add_generic_attributes(["id", "class", "dir", "role", "aria-hidden", "aria-label"])
            .rm_tag_attributes("img", ["align"])
            .add_tag_attributes("img", ["style"])
            .add_tag_attributes("ol", ["type", "reversed"])
            .add_tag_attributes("li", ["value"])
            .add_tag_attributes("th", ["style"])
            .add_tag_attributes("td", ["style"])
            .add_tag_attributes("col", ["style", "width"])
            .filter_style_properties(HashSet::from(["text-align", "width"]))
            .url_schemes(HashSet::from(["http", "https", "mailto", "data"]))
            .url_relative(UrlRelative::Custom(Box::new(fragment_only)))
            .link_rel(Some("noopener noreferrer nofollow ugc"))
            .attribute_filter(|element, attribute, value| match (element, attribute) {
                ("img", "src") => image_source(value).then_some(Cow::Borrowed(value)),
                ("img", "style") => image_width(value),
                (_, "href") if data_link(value) => None,
                _ => Some(Cow::Borrowed(value)),
            });
        for tag in MATHML_TAGS {
            builder.add_tag_attributes(tag, MATHML_ATTRIBUTES);
        }
        builder
    });
    &SANITIZER
}

pub fn sanitize(html: &str) -> String {
    sanitizer().clean(html).to_string()
}

pub fn public_url(base: &Url, slug: &str) -> String {
    format!(
        "{}/{PUBLIC_PATH}/{slug}",
        base.as_str().trim_end_matches('/')
    )
}

fn day(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|at| at.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

pub fn render(page: &Page, server_name: &str) -> String {
    let title = escape(&page.title);
    let date = day(page.updated_at);
    format!(
        "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"robots\" content=\"noindex, nofollow\"><meta name=\"referrer\" content=\"no-referrer\"><meta name=\"color-scheme\" content=\"light dark\"><title>{title}</title><style>{NOTE_STYLE}</style></head><body><article class=\"note\"><header><h1>{title}</h1><time datetime=\"{date}\">{date}</time></header>{}</article><footer class=\"foot\">{}</footer></body></html>",
        page.html,
        escape(server_name)
    )
}

pub fn page_etag(page: &Page, server_name: &str) -> String {
    let template =
        sha256_b64url(format!("{}\u{0}{server_name}", env!("CARGO_PKG_VERSION")).as_bytes());
    format!("\"{}.{}\"", page.etag, &template[..8])
}

pub fn check_upload(upload: &Upload, limit: u64) -> Result<(), ServerError> {
    let source = upload.source.trim();
    if source.is_empty()
        || source.chars().count() > MAX_SOURCE_CHARS
        || source.chars().any(char::is_control)
    {
        return Err(ServerError::invalid(
            "invalid_source",
            "Name the note this page comes from.",
        ));
    }
    let title = upload.title.trim();
    if title.is_empty()
        || title.chars().count() > MAX_TITLE_CHARS
        || title.chars().any(char::is_control)
    {
        return Err(ServerError::invalid(
            "invalid_title",
            format!("A page title needs 1 to {MAX_TITLE_CHARS} characters."),
        ));
    }
    if upload.html.len() as u64 > limit {
        return Err(too_large(limit));
    }
    Ok(())
}

pub fn too_large(limit: u64) -> ServerError {
    ServerError::Refused {
        status: StatusCode::PAYLOAD_TOO_LARGE,
        code: "page_too_large",
        message: format!(
            "This page is larger than the {} MB this server allows. Remove some images and try again.",
            limit.div_ceil(1024 * 1024)
        ),
    }
}

pub fn turned_off() -> ServerError {
    ServerError::Refused {
        status: StatusCode::FORBIDDEN,
        code: "public_notes_off",
        message: "This server doesn't allow public note links. Ask an admin to turn them on."
            .to_string(),
    }
}

fn read_note(row: &rusqlite::Row<'_>, base: &Url) -> rusqlite::Result<PublishedNote> {
    let slug: String = row.get(1)?;
    Ok(PublishedNote {
        id: row.get(0)?,
        url: public_url(base, &slug),
        source: row.get(2)?,
        title: row.get(3)?,
        size: u64::try_from(row.get::<_, i64>(4)?).unwrap_or(0),
        published_at: row.get(5)?,
        updated_at: row.get(6)?,
        taken_down: row.get::<_, Option<i64>>(7)?.is_some(),
    })
}

const NOTE_COLUMNS: &str = "SELECT id, slug, source, title, size, published_at, updated_at, taken_down_at, account_id, removed_at FROM published_notes";

fn logged(
    conn: &Connection,
    now: i64,
    actor: AccountId,
    kind: SecurityEventKind,
    note: &PublishedNote,
    ip: Option<String>,
    by_admin: bool,
) -> Result<(), ServerError> {
    let detail = if by_admin {
        json!({ "title": note.title, "by_admin": true })
    } else {
        json!({ "title": note.title })
    };
    security_log::record(
        conn,
        now,
        NewSecurityEvent {
            actor: Some(actor),
            kind,
            target: Some(note.id.clone()),
            ip,
            detail,
        },
    )?;
    Ok(())
}

pub fn taken_down() -> ServerError {
    ServerError::Refused {
        status: StatusCode::FORBIDDEN,
        code: "page_taken_down",
        message: "An admin took this page down, so this note can't be published again until they put it back.".to_string(),
    }
}

pub fn list(
    conn: &Connection,
    account: AccountId,
    base: &Url,
) -> Result<Vec<PublishedNote>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "{NOTE_COLUMNS} WHERE account_id = ?1 AND removed_at IS NULL ORDER BY updated_at DESC, id DESC"
    ))?;
    let rows = statement.query_map([account.to_string()], |row| read_note(row, base))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

fn count(conn: &Connection, account: AccountId) -> Result<u32, ServerError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM published_notes WHERE account_id = ?1 AND removed_at IS NULL",
        [account.to_string()],
        |row| row.get(0),
    )?;
    Ok(u32::try_from(count).unwrap_or(u32::MAX))
}

pub struct Publish<'a> {
    pub account: AccountId,
    pub upload: &'a Upload,
    pub storage: Option<Storage>,
    pub uploads: Option<u32>,
    pub base: &'a Url,
    pub ip: Option<String>,
    pub now: i64,
}

pub fn store(conn: &mut Connection, publish: Publish<'_>) -> Result<PublishedNote, ServerError> {
    let Publish {
        account,
        upload,
        storage,
        uploads,
        base,
        ip,
        now,
    } = publish;
    let transaction = conn.transaction()?;
    if !settings::load(&transaction)?.public_notes_allowed {
        return Err(turned_off());
    }
    let source = upload.source.trim();
    let existing: Option<(String, i64, Option<i64>)> = transaction
        .query_row(
            "SELECT id, size, taken_down_at FROM published_notes WHERE account_id = ?1 AND source = ?2",
            params![account.to_string(), source],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()?;
    if existing.as_ref().is_some_and(|(_, _, down)| down.is_some()) {
        return Err(taken_down());
    }
    if existing.is_none() && count(&transaction, account)? >= MAX_PAGES_PER_ACCOUNT {
        return Err(ServerError::Refused {
            status: StatusCode::TOO_MANY_REQUESTS,
            code: "too_many_pages",
            message: format!(
                "You already have {MAX_PAGES_PER_ACCOUNT} public pages on this server. Unpublish one before you publish another."
            ),
        });
    }
    let size = upload.html.len() as u64;
    if let Some(storage) = storage {
        let freeing = existing
            .as_ref()
            .map_or(0, |(_, size, _)| u64::try_from(*size).unwrap_or(0));
        storage.check(&transaction, size, freeing)?;
    }
    quotas::count_upload(&transaction, account, uploads, now)?;
    let title = upload.title.trim();
    let etag = sha256_b64url(format!("{title}\u{0}{}", upload.html).as_bytes())[..16].to_string();
    let size = i64::try_from(size).unwrap_or(i64::MAX);
    let created = existing.is_none();
    let id = match existing {
        Some((id, _, _)) => {
            transaction.execute(
                "UPDATE published_notes SET title = ?2, html = ?3, size = ?4, etag = ?5, updated_at = ?6 WHERE id = ?1",
                params![id, title, upload.html, size, etag, now],
            )?;
            id
        }
        None => {
            let id = uuid::Uuid::now_v7().to_string();
            let slug = tokens::random_token()[..SLUG_CHARS].to_string();
            transaction.execute(
                "INSERT INTO published_notes (id, slug, account_id, source, title, html, size, etag, published_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                params![id, slug, account.to_string(), source, title, upload.html, size, etag, now],
            )?;
            id
        }
    };
    let stored = find(&transaction, &id, base)?
        .ok_or(ServerError::NotFound)?
        .0;
    if created {
        logged(
            &transaction,
            now,
            account,
            SecurityEventKind::NotePublished,
            &stored,
            ip,
            false,
        )?;
    }
    transaction.commit()?;
    Ok(stored)
}

fn find(
    conn: &Connection,
    id: &str,
    base: &Url,
) -> Result<Option<(PublishedNote, AccountId, bool)>, ServerError> {
    let found = conn
        .query_row(&format!("{NOTE_COLUMNS} WHERE id = ?1"), [id], |row| {
            Ok((
                read_note(row, base)?,
                row.get::<_, String>(8)?,
                row.get::<_, Option<i64>>(9)?.is_some(),
            ))
        })
        .optional()?;
    found
        .map(|(note, author, removed)| Ok((note, parse_id::<AccountId>(&author)?, removed)))
        .transpose()
}

pub struct Change<'a> {
    pub actor: AccountId,
    pub id: &'a str,
    pub base: &'a Url,
    pub ip: Option<String>,
    pub now: i64,
}

pub fn remove(conn: &mut Connection, change: Change<'_>) -> Result<(), ServerError> {
    let transaction = conn.transaction()?;
    let note = match find(&transaction, change.id, change.base)? {
        Some((note, author, false)) if author == change.actor => note,
        _ => return Err(ServerError::NotFound),
    };
    if note.taken_down {
        transaction.execute(
            "UPDATE published_notes SET html = '', size = 0, removed_at = ?2 WHERE id = ?1",
            params![change.id, change.now],
        )?;
    } else {
        transaction.execute("DELETE FROM published_notes WHERE id = ?1", [change.id])?;
    }
    logged(
        &transaction,
        change.now,
        change.actor,
        SecurityEventKind::NoteUnpublished,
        &note,
        change.ip,
        false,
    )?;
    transaction.commit()?;
    Ok(())
}

pub fn admin_list(conn: &Connection, base: &Url) -> Result<Vec<AdminPublishedNote>, ServerError> {
    let mut statement = conn.prepare(&format!(
        "{NOTE_COLUMNS} ORDER BY updated_at DESC, id DESC LIMIT {ADMIN_LIST_LIMIT}"
    ))?;
    let rows = statement.query_map([], |row| {
        Ok((read_note(row, base)?, row.get::<_, String>(8)?))
    })?;
    let mut listed = Vec::new();
    for row in rows {
        let (note, author) = row?;
        let author = projects::person(conn, parse_id(&author)?, true)?;
        listed.push(AdminPublishedNote { note, author });
    }
    Ok(listed)
}

pub fn set_taken_down(
    conn: &mut Connection,
    change: Change<'_>,
    down: bool,
) -> Result<AdminPublishedNote, ServerError> {
    let transaction = conn.transaction()?;
    let (note, author, removed) =
        find(&transaction, change.id, change.base)?.ok_or(ServerError::NotFound)?;
    if note.taken_down != down {
        if removed {
            transaction.execute("DELETE FROM published_notes WHERE id = ?1", [change.id])?;
        } else {
            transaction.execute(
                "UPDATE published_notes SET taken_down_at = ?2 WHERE id = ?1",
                params![change.id, down.then_some(change.now)],
            )?;
        }
        let kind = if down {
            SecurityEventKind::NoteTakenDown
        } else {
            SecurityEventKind::NoteRestored
        };
        logged(
            &transaction,
            change.now,
            change.actor,
            kind,
            &note,
            change.ip,
            true,
        )?;
    }
    let note = PublishedNote {
        taken_down: down,
        ..note
    };
    let author = projects::person(&transaction, author, true)?;
    transaction.commit()?;
    Ok(AdminPublishedNote { note, author })
}

pub fn page(conn: &Connection, slug: &str) -> Result<Option<Page>, ServerError> {
    if slug.len() != SLUG_CHARS
        || !slug
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
        || !settings::load(conn)?.public_notes_allowed
    {
        return Ok(None);
    }
    Ok(conn
        .query_row(
            "SELECT n.title, n.html, n.etag, n.updated_at FROM published_notes n \
             JOIN accounts a ON a.id = n.account_id \
             WHERE n.slug = ?1 AND a.status = 'active' AND n.taken_down_at IS NULL",
            [slug],
            |row| {
                Ok(Page {
                    title: row.get(0)?,
                    html: row.get(1)?,
                    etag: row.get(2)?,
                    updated_at: row.get(3)?,
                })
            },
        )
        .optional()?)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(html: &str) -> String {
        sanitize(html)
    }

    #[test]
    fn scripts_handlers_and_frames_never_survive() {
        let cleaned = clean(concat!(
            "<p onclick=\"alert(1)\">Hi<script>alert(2)</script></p>",
            "<img src=x onerror=alert(3)>",
            "<iframe src=\"https://example.org\">inside</iframe>",
            "<style>body{display:none}</style>",
            "<a href=\"javascript:alert(4)\">js</a>",
            "<form action=\"https://example.org\"><input name=q></form>",
            "<svg><script>alert(5)</script><text>drawn</text></svg>",
            "<object data=\"x\">obj</object>",
            "<meta http-equiv=\"refresh\" content=\"0;url=https://example.org\">",
            "<base href=\"https://example.org/\">",
        ));
        for banned in [
            "script",
            "onclick",
            "onerror",
            "iframe",
            "inside",
            "style",
            "javascript",
            "form",
            "input",
            "svg",
            "drawn",
            "object",
            "meta",
            "base",
            "alert",
        ] {
            assert!(!cleaned.contains(banned), "{banned} survived in {cleaned}");
        }
        assert!(cleaned.contains("<p>Hi</p>"));
    }

    #[test]
    fn only_embedded_images_of_known_types_keep_their_source() {
        let cleaned = clean(concat!(
            "<img alt=a src=\"data:image/png;base64,AAAA\">",
            "<img alt=b src=\"data:image/svg+xml;base64,PHN2Zz4=\">",
            "<img alt=c src=\"https://tracker.example/pixel.gif\">",
            "<img alt=d src=\"data:text/html;base64,PHNjcmlwdD4=\">",
            "<img alt=e src=\"data:image/svg+xmlfoo,x\">",
        ));
        assert!(cleaned.contains("src=\"data:image/png;base64,AAAA\""));
        assert!(cleaned.contains("src=\"data:image/svg+xml;base64,PHN2Zz4=\""));
        assert!(!cleaned.contains("tracker"));
        assert!(!cleaned.contains("text/html"));
        assert!(!cleaned.contains("svg+xmlfoo"));
        assert_eq!(cleaned.matches("<img").count(), 5);
    }

    #[test]
    fn links_keep_web_mail_and_footnote_targets_only() {
        let cleaned = clean(concat!(
            "<a href=\"https://example.org/paper\">web</a>",
            "<a href=\"mailto:ada@example.org\">mail</a>",
            "<a href=\"#fn1\" id=\"fnref1\" class=\"footnote-ref\" role=\"doc-noteref\"><sup>1</sup></a>",
            "<a href=\"data:text/html,hi\">data</a>",
            "<a href=\"/admin\">relative</a>",
            "<a href=\"oleafly://open?project=1\">app</a>",
        ));
        assert!(cleaned.contains(
            "<a href=\"https://example.org/paper\" rel=\"noopener noreferrer nofollow ugc\">web</a>"
        ));
        assert!(cleaned.contains("href=\"mailto:ada@example.org\""));
        assert!(cleaned.contains("href=\"#fn1\""));
        assert!(cleaned.contains("id=\"fnref1\""));
        assert!(cleaned.contains("role=\"doc-noteref\""));
        assert!(!cleaned.contains("data:text"));
        assert!(!cleaned.contains("/admin"));
        assert!(!cleaned.contains("oleafly://"));
    }

    #[test]
    fn mathml_survives_but_annotations_and_foreign_content_do_not() {
        let cleaned = clean(concat!(
            "<math display=\"block\" xmlns=\"http://www.w3.org/1998/Math/MathML\"><semantics><mrow>",
            "<mi>x</mi><mo stretchy=\"false\">=</mo><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow>",
            "<annotation encoding=\"application/x-tex\">x = \\frac12</annotation>",
            "<annotation-xml encoding=\"text/html\"><img src=x onerror=alert(1)></annotation-xml>",
            "</semantics></math>",
        ));
        assert!(cleaned.contains("<math display=\"block\">"));
        assert!(cleaned.contains("<mo stretchy=\"false\">=</mo>"));
        assert!(cleaned.contains("<mfrac><mn>1</mn><mn>2</mn></mfrac>"));
        assert!(!cleaned.contains("annotation"));
        assert!(!cleaned.contains("frac12"));
        assert!(!cleaned.contains("onerror"));
    }

    #[test]
    fn tables_keep_alignment_and_width_but_no_other_styles() {
        let cleaned = clean(concat!(
            "<table><colgroup><col style=\"width: 40%\"></colgroup><tbody><tr>",
            "<td style=\"text-align: right; background: url(https://tracker.example/x)\">1</td>",
            "</tr></tbody></table><p style=\"position:fixed\">p</p>",
        ));
        assert!(cleaned.contains("<col style=\"width:40%\">"));
        assert!(cleaned.contains("<td style=\"text-align:right\">1</td>"));
        assert!(!cleaned.contains("tracker"));
        assert!(!cleaned.contains("position"));
    }

    #[test]
    fn images_keep_a_plain_width_and_nothing_else_from_their_style() {
        let cleaned = clean(concat!(
            "<img alt=a src=\"data:image/png;base64,AA\" style=\"width:40.0%; position:fixed\">",
            "<img alt=b src=\"data:image/png;base64,AA\" style=\"position:fixed;width:320px\">",
            "<img alt=c src=\"data:image/png;base64,AA\" style=\"width:calc(100vw)\">",
            "<img alt=d src=\"data:image/png;base64,AA\" style=\"width:url(https://tracker.example/x)%\">",
            "<img alt=e src=\"data:image/png;base64,AA\" style=\"background:url(https://tracker.example/y)\">",
        ));
        assert!(cleaned
            .contains("<img alt=\"a\" src=\"data:image/png;base64,AA\" style=\"width:40.0%\">"));
        assert!(cleaned
            .contains("<img alt=\"b\" src=\"data:image/png;base64,AA\" style=\"width:320px\">"));
        assert!(cleaned.contains("<img alt=\"c\" src=\"data:image/png;base64,AA\">"));
        assert!(cleaned.contains("<img alt=\"d\" src=\"data:image/png;base64,AA\">"));
        assert!(cleaned.contains("<img alt=\"e\" src=\"data:image/png;base64,AA\">"));
        assert!(!cleaned.contains("position"));
        assert!(!cleaned.contains("tracker"));
        assert!(!cleaned.contains("calc"));
    }

    #[test]
    fn pandoc_code_footnotes_and_figures_keep_their_structure() {
        let cleaned = clean(concat!(
            "<div class=\"sourceCode\" id=\"cb1\"><pre class=\"sourceCode python\"><code class=\"sourceCode python\">",
            "<span class=\"kw\">def</span> f()</code></pre></div>",
            "<figure><img src=\"data:image/png;base64,AAAA\" alt=\"Plot\"><figcaption aria-hidden=\"true\">Plot</figcaption></figure>",
            "<section id=\"footnotes\" class=\"footnotes\" role=\"doc-endnotes\"><hr><ol><li id=\"fn1\"><p>Note</p></li></ol></section>",
        ));
        assert!(cleaned.contains("<code class=\"sourceCode python\"><span class=\"kw\">def</span>"));
        assert!(cleaned.contains("<figcaption aria-hidden=\"true\">Plot</figcaption>"));
        assert!(cleaned
            .contains("<section id=\"footnotes\" class=\"footnotes\" role=\"doc-endnotes\">"));
        assert!(cleaned.contains("<li id=\"fn1\">"));
    }

    #[test]
    fn the_page_escapes_its_title_and_server_name() {
        let page = Page {
            title: "Notes <script>".to_string(),
            html: "<p>Body</p>".to_string(),
            etag: "abc".to_string(),
            updated_at: 1_762_819_200_000,
        };
        let html = render(&page, "Lab & <Co>");
        assert!(html.starts_with("<!doctype html>"));
        assert!(html.contains("<title>Notes &lt;script&gt;</title>"));
        assert!(html.contains("<h1>Notes &lt;script&gt;</h1>"));
        assert!(html.contains("<time datetime=\"2025-11-11\">2025-11-11</time>"));
        assert!(html.contains("<p>Body</p></article>"));
        assert!(html.contains("<footer class=\"foot\">Lab &amp; &lt;Co&gt;</footer>"));
        assert!(html.contains("<meta name=\"robots\" content=\"noindex, nofollow\">"));
        let tag = page_etag(&page, "Lab");
        assert!(tag.starts_with("\"abc.") && tag.ends_with('"'));
        assert_ne!(tag, page_etag(&page, "Other lab"));
    }

    #[test]
    fn uploads_need_a_source_a_title_and_a_size_within_the_limit() {
        let upload = |source: &str, title: &str, html: &str| Upload {
            source: source.to_string(),
            title: title.to_string(),
            html: html.to_string(),
        };
        let code = |result: Result<(), ServerError>| result.map_err(|error| error.code());
        assert_eq!(
            code(check_upload(&upload("n1", "Title", "<p>x</p>"), 100)),
            Ok(())
        );
        assert_eq!(
            code(check_upload(&upload(" ", "Title", "x"), 100)),
            Err("invalid_source")
        );
        assert_eq!(
            code(check_upload(&upload("n1", "", "x"), 100)),
            Err("invalid_title")
        );
        assert_eq!(
            code(check_upload(&upload("n1", &"t".repeat(201), "x"), 100)),
            Err("invalid_title")
        );
        assert_eq!(
            code(check_upload(&upload("n1", "Bad\u{7}", "x"), 100)),
            Err("invalid_title")
        );
        assert_eq!(
            code(check_upload(&upload("n1", "Title", &"x".repeat(101)), 100)),
            Err("page_too_large")
        );
        assert!(too_large(8 * 1024 * 1024).to_string().contains("8 MB"));
    }

    #[test]
    fn public_urls_keep_the_server_path() {
        let base = Url::parse("https://lab.example.org/collab/").unwrap();
        assert_eq!(
            public_url(&base, "abcdefghijklmnop"),
            "https://lab.example.org/collab/n/abcdefghijklmnop"
        );
    }
}
