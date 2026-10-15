//! Custom templates from an online LaTeX account: a page from its public
//! template gallery, or one of the account's own projects.
//!
//! The gallery shows a template's details and first page to anyone, but hands
//! out its files only to a signed-in account, by copying the template into
//! that account (its Open as Template button). Importing a gallery link does
//! the same with the saved sign-in, then downloads the copy.

use serde::Serialize;
use serde_json::{Map, Value};
use tauri::AppHandle;

use super::client::{self, Http};
use super::html;
use super::import;
use super::session;
use super::socket;
use crate::app_error::AppError;
use crate::custom_templates::{self, TemplateDraft, TemplateSource};
use crate::templates::TemplateLicense;

const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_PDF_BYTES: usize = 40 * 1024 * 1024;
const MAX_REDIRECTS: usize = 3;
const GALLERY_KINDS: [&[&str]; 3] = [
    &["latex", "templates"],
    &["latex", "examples"],
    &["articles"],
];

/// A gallery page: the server it lives on and its path below that server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TemplateLink {
    pub base: String,
    pub page: String,
}

impl TemplateLink {
    pub(crate) fn url(&self) -> String {
        format!("{}{}", self.base, self.page)
    }
}

fn invalid_link() -> String {
    AppError::new("overleaf.template_link_invalid").into()
}

fn unavailable() -> String {
    AppError::new("overleaf.template_unavailable").into()
}

fn gallery_host(host: &str) -> bool {
    host == "overleaf.com" || host.ends_with(".overleaf.com")
}

fn safe_segment(segment: &str) -> bool {
    !segment.is_empty()
        && segment != "."
        && segment != ".."
        && segment
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
}

/// Accept a link to a gallery page on overleaf.com (any language subdomain),
/// or on the server the account import uses, which covers a university's own
/// server. The page's PDF link is accepted too and read as the page.
pub(crate) fn parse_link(input: &str, server: &str) -> Result<TemplateLink, String> {
    let raw = input.trim();
    let with_scheme = if raw.contains("://") {
        raw.to_string()
    } else {
        format!("https://{raw}")
    };
    let url = tauri::Url::parse(&with_scheme).map_err(|_| invalid_link())?;
    if !matches!(url.scheme(), "https" | "http") {
        return Err(invalid_link());
    }
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let (base, path) = if gallery_host(&host) {
        (session::DEFAULT_SERVER.to_string(), url.path().to_string())
    } else {
        let base = session::normalize_server(Some(server))?;
        let origin = url.origin().ascii_serialization();
        let base_path = base
            .strip_prefix(&session::origin_of(&base))
            .unwrap_or_default()
            .to_string();
        if origin != session::origin_of(&base) {
            return Err(invalid_link());
        }
        let path = url
            .path()
            .strip_prefix(&base_path)
            .filter(|rest| rest.starts_with('/'))
            .ok_or_else(invalid_link)?
            .to_string();
        (base, path)
    };
    let mut segments: Vec<String> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(str::to_string)
        .collect();
    if let Some(last) = segments.last_mut() {
        if let Some(stem) = last.strip_suffix(".pdf") {
            *last = stem.to_string();
        }
    }
    let kind = GALLERY_KINDS
        .iter()
        .find(|kind| {
            segments.len() == kind.len() + 2
                && segments.iter().zip(kind.iter()).all(|(a, b)| a == b)
        })
        .ok_or_else(invalid_link)?;
    if !segments[kind.len()..]
        .iter()
        .all(|segment| safe_segment(segment))
    {
        return Err(invalid_link());
    }
    Ok(TemplateLink {
        base,
        page: format!("/{}", segments.join("/")),
    })
}

/// What the page's Open as Template link carries.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct OpenAsTemplate {
    pub version_id: String,
    pub template_id: String,
    pub name: Option<String>,
    pub engine: Option<String>,
    pub main_file: Option<String>,
    pub image: Option<String>,
    pub brand_variation_id: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct TemplatePage {
    pub title: Option<String>,
    pub author: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub open: Option<OpenAsTemplate>,
    pub has_pdf: bool,
}

fn digits(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit())
}

fn open_as_template(page: &str) -> Option<OpenAsTemplate> {
    const MARKER: &str = "/project/new/template/";
    let at = page.find(MARKER)?;
    let start = page[..at].rfind(['"', '\'']).map_or(at, |quote| quote + 1);
    let end = page[at..]
        .find(['"', '\''])
        .map_or(page.len(), |end| at + end);
    let href = html::decode_entities(&page[start..end]);
    let href = if href.contains("://") {
        href
    } else {
        format!("https://gallery.invalid{}", &href[href.find(MARKER)?..])
    };
    let url = tauri::Url::parse(&href).ok()?;
    let version_id = url.path().rsplit('/').next()?.to_string();
    let query = |key: &str| {
        url.query_pairs()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.trim().to_string())
            .filter(|value| !value.is_empty())
    };
    let template_id = query("id")?;
    if !digits(&version_id) || !digits(&template_id) {
        return None;
    }
    Some(OpenAsTemplate {
        version_id,
        template_id,
        name: query("templateName"),
        engine: query("latexEngine"),
        main_file: query("mainFile"),
        image: query("texImage"),
        brand_variation_id: query("brandVariationId").filter(|id| digits(id)),
    })
}

fn strip_tags(fragment: &str) -> String {
    let mut text = String::with_capacity(fragment.len());
    let mut inside = false;
    for character in fragment.chars() {
        match character {
            '<' => {
                inside = true;
                text.push(' ');
            }
            '>' => inside = false,
            _ if !inside => text.push(character),
            _ => {}
        }
    }
    let decoded = html::decode_entities(&text);
    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// The value beside a bold label in the page's details list, such as
/// `<div><b>Author:</b></div><div>IEEE</div>`.
fn detail(page: &str, label: &str) -> Option<String> {
    let marker = format!("<b>{label}</b>");
    let at = page.find(&marker)? + marker.len();
    let rest = &page[at..];
    let open = rest.find("<div")?;
    let content = open + rest[open..].find('>')? + 1;
    let close = content + rest[content..].find("</div>")?;
    Some(strip_tags(&rest[content..close])).filter(|text| !text.is_empty())
}

pub(crate) fn parse_page(page: &str, page_path: &str) -> TemplatePage {
    let tags = html::meta_tags(page);
    let open = open_as_template(page);
    let title = html::meta_text(&tags, "og:title")
        .or_else(|| html::meta_text(&tags, "twitter:title"))
        .map(|title| title.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|title| !title.is_empty())
        .or_else(|| open.as_ref().and_then(|open| open.name.clone()));
    TemplatePage {
        title,
        author: detail(page, "Author:"),
        license: detail(page, "License:"),
        description: detail(page, "Abstract:"),
        has_pdf: page.contains(&format!("\"{page_path}.pdf\"")),
        open,
    }
}

/// Fetch a public page, following the gallery's own redirects (a renamed
/// template keeps its old address) as long as they stay on the same server.
async fn fetch_public(http: &Http, path: &str, limit: usize) -> Result<Vec<u8>, String> {
    let mut path = path.to_string();
    for _ in 0..=MAX_REDIRECTS {
        let response = http.send_public(http.public_get(&path)).await?;
        let status = response.status();
        if status.is_redirection() {
            let location = response
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|value| value.to_str().ok())
                .unwrap_or_default();
            let next = tauri::Url::parse(&http.url(&path))
                .and_then(|current| current.join(location))
                .map_err(|_| unavailable())?;
            let base = tauri::Url::parse(&http.base).map_err(|_| unavailable())?;
            if next.origin() != base.origin() {
                return Err(unavailable());
            }
            let base_path = base.path().trim_end_matches('/');
            path = next
                .path()
                .strip_prefix(base_path)
                .filter(|rest| rest.starts_with('/'))
                .ok_or_else(unavailable)?
                .to_string();
            continue;
        }
        if status == reqwest::StatusCode::TOO_MANY_REQUESTS {
            return Err(AppError::new("overleaf.rate_limited").into());
        }
        if !status.is_success() {
            return Err(unavailable());
        }
        if response
            .content_length()
            .is_some_and(|length| length as usize > limit)
        {
            return Err(unavailable());
        }
        let bytes = response.bytes().await.map_err(|error| error.to_string())?;
        if bytes.len() > limit {
            return Err(unavailable());
        }
        return Ok(bytes.to_vec());
    }
    Err(unavailable())
}

async fn read_page(http: &Http, link: &TemplateLink) -> Result<TemplatePage, String> {
    let bytes = fetch_public(http, &link.page, MAX_PAGE_BYTES).await?;
    let page = parse_page(&String::from_utf8_lossy(&bytes), &link.page);
    if page.open.is_none() {
        return Err(unavailable());
    }
    Ok(page)
}

fn compiler_name(engine: Option<&str>) -> Option<&'static str> {
    match engine?.trim().to_ascii_lowercase().as_str() {
        "pdflatex" => Some("pdflatex"),
        "xelatex" => Some("xelatex"),
        "lualatex" => Some("lualatex"),
        "latex" | "latex_dvipdf" => Some("latex"),
        _ => None,
    }
}

#[derive(Serialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TemplateDetails {
    /// The server whose sign-in the import needs.
    pub server: String,
    pub link: String,
    pub title: String,
    pub author: Option<String>,
    pub license: Option<String>,
    pub description: Option<String>,
    pub compiler: Option<String>,
    pub main_file: Option<String>,
    pub has_pdf: bool,
}

fn details_for(link: &TemplateLink, page: TemplatePage) -> TemplateDetails {
    let open = page.open.unwrap_or_default();
    TemplateDetails {
        server: link.base.clone(),
        link: link.url(),
        title: page
            .title
            .or(open.name)
            .unwrap_or_else(|| "Untitled template".to_string()),
        author: page.author,
        license: page.license,
        description: page.description,
        compiler: compiler_name(open.engine.as_deref())
            .and_then(socket::flavor_for_compiler)
            .map(str::to_string),
        main_file: open.main_file,
        has_pdf: page.has_pdf,
    }
}

/// The body for the server's Open as Template request. Fields it does not
/// know are left out, since it rejects unexpected or empty ones.
pub(crate) fn create_body(open: &OpenAsTemplate, name: &str) -> Value {
    let mut body = Map::new();
    body.insert("templateId".into(), Value::String(open.template_id.clone()));
    body.insert(
        "templateVersionId".into(),
        Value::String(open.version_id.clone()),
    );
    let name = name.trim();
    if !name.is_empty() {
        body.insert("templateName".into(), Value::String(name.to_string()));
    }
    if let Some(compiler) = compiler_name(open.engine.as_deref()) {
        body.insert("compiler".into(), Value::String(compiler.to_string()));
    }
    for (key, value) in [
        ("mainFile", &open.main_file),
        ("imageName", &open.image),
        ("brandVariationId", &open.brand_variation_id),
    ] {
        if let Some(value) = value {
            body.insert(key.into(), Value::String(value.clone()));
        }
    }
    Value::Object(body)
}

/// The saved sign-in for `base`, refreshed, with a token for form posts.
async fn signed_in(base: &str) -> Result<(Http, String, String), String> {
    let stored =
        session::load(base)?.ok_or_else(|| String::from(AppError::new("overleaf.signed_out")))?;
    let http = Http::new(base)?;
    let dashboard = match http.dashboard(&stored.cookie).await {
        Ok(dashboard) => dashboard,
        Err(error) => {
            if client::is_expired(&error) {
                let _ = session::forget(base);
            }
            return Err(error);
        }
    };
    let cookie = session::merge_set_cookies(
        &stored.cookie,
        dashboard.set_cookies.iter().map(String::as_str),
    );
    let _ = session::refresh_cookie(base, &stored, &cookie);
    let csrf = dashboard
        .csrf
        .ok_or_else(|| String::from(AppError::new("overleaf.unrecognized")))?;
    Ok((http, cookie, csrf))
}

struct Download(std::path::PathBuf);

impl Drop for Download {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

async fn download_and_publish(
    http: &Http,
    cookie: &str,
    project_id: &str,
    reserved: Vec<String>,
    draft: TemplateDraft,
) -> Result<String, String> {
    let custom_root = crate::templates::custom_templates_root()?;
    let download = Download(custom_templates::download_path(&custom_root)?);
    let result = match http
        .download_zip(cookie, project_id, &download.0, |_, _| {})
        .await
    {
        Ok(_) => {
            let archive = download.0.clone();
            tauri::async_runtime::spawn_blocking(move || {
                custom_templates::publish_template(
                    &custom_root,
                    &reserved,
                    TemplateSource::Archive(&archive),
                    draft,
                )
            })
            .await
            .map_err(|error| error.to_string())?
        }
        Err(error) => Err(error),
    };
    drop(download);
    result
}

fn forget_if_expired(base: &str, result: Result<String, String>) -> Result<String, String> {
    if let Err(error) = &result {
        if client::is_expired(error) {
            let _ = session::forget(base);
        }
    }
    result
}

/// A gallery page's details, for showing before anything is imported. No
/// sign-in is needed.
#[tauri::command]
pub async fn overleaf_template_details(
    server: Option<String>,
    link: String,
) -> Result<TemplateDetails, String> {
    let server = session::normalize_server(server.as_deref())?;
    let link = parse_link(&link, &server)?;
    let http = Http::new(&link.base)?;
    let page = read_page(&http, &link).await?;
    Ok(details_for(&link, page))
}

/// The PDF the gallery shows for a template, for rendering its first page.
#[tauri::command]
pub async fn overleaf_template_pdf(
    server: Option<String>,
    link: String,
) -> Result<tauri::ipc::Response, String> {
    let server = session::normalize_server(server.as_deref())?;
    let link = parse_link(&link, &server)?;
    let http = Http::new(&link.base)?;
    let bytes = fetch_public(&http, &format!("{}.pdf", link.page), MAX_PDF_BYTES).await?;
    if !bytes.starts_with(b"%PDF") {
        return Err(unavailable());
    }
    Ok(tauri::ipc::Response::new(bytes))
}

/// Copy a gallery template into the signed-in account, download the copy and
/// save it as a custom template. The copy stays in the account, as it would
/// after Open as Template there.
#[tauri::command]
pub async fn overleaf_import_template(
    app: AppHandle,
    server: Option<String>,
    link: String,
    name: String,
    preview_png_base64: Option<String>,
) -> Result<String, String> {
    let reserved = crate::templates::shipped_template_ids_off_thread(app).await?;
    import_template(server.as_deref(), &link, name, preview_png_base64, reserved).await
}

pub(crate) async fn import_template(
    server: Option<&str>,
    link: &str,
    name: String,
    preview_png_base64: Option<String>,
    reserved: Vec<String>,
) -> Result<String, String> {
    let server = session::normalize_server(server)?;
    let link = parse_link(link, &server)?;
    let result = async {
        let (http, cookie, csrf) = signed_in(&link.base).await?;
        let page = read_page(&http, &link).await?;
        let open = page.open.clone().ok_or_else(unavailable)?;
        let project_id = http
            .create_from_template(&cookie, &csrf, &create_body(&open, &name))
            .await?;
        let draft = TemplateDraft {
            name,
            description: page.description.clone().unwrap_or_default(),
            main_doc: open.main_file.clone(),
            tex_flavor: compiler_name(open.engine.as_deref())
                .and_then(socket::flavor_for_compiler)
                .map(str::to_string),
            license: Some(TemplateLicense {
                spdx: page.license.clone().unwrap_or_default(),
                author: page.author.clone().unwrap_or_default(),
                url: link.url(),
            }),
            preview_png: custom_templates::decode_preview(preview_png_base64.as_deref()),
        };
        download_and_publish(&http, &cookie, &project_id, reserved, draft).await
    }
    .await;
    forget_if_expired(&link.base, result)
}

/// Save one of the account's projects as a custom template, keeping its main
/// document and compiler. Nothing changes in the account.
#[tauri::command]
pub async fn overleaf_save_project_as_template(
    app: AppHandle,
    server: Option<String>,
    project_id: String,
    name: String,
) -> Result<String, String> {
    let reserved = crate::templates::shipped_template_ids_off_thread(app).await?;
    save_project_as_template(server.as_deref(), &project_id, name, reserved).await
}

pub(crate) async fn save_project_as_template(
    server: Option<&str>,
    project_id: &str,
    name: String,
    reserved: Vec<String>,
) -> Result<String, String> {
    let base = session::normalize_server(server)?;
    let result = async {
        let (session, projects) = import::list(&base).await?;
        if !projects.iter().any(|project| project.id == project_id) {
            return Err(AppError::new("overleaf.project_unavailable").into());
        }
        let http = Http::new(&base)?;
        let settings = socket::fetch_project(&http, &session.cookie, project_id)
            .await
            .map(|project| socket::settings_from_project(&project))
            .unwrap_or_default();
        let draft = TemplateDraft {
            name,
            main_doc: settings.main_doc,
            tex_flavor: settings
                .compiler
                .as_deref()
                .and_then(socket::flavor_for_compiler)
                .map(str::to_string),
            ..TemplateDraft::default()
        };
        download_and_publish(&http, &session.cookie, project_id, reserved, draft).await
    }
    .await;
    forget_if_expired(&base, result)
}
