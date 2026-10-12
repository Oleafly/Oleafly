use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::capabilities::ProviderInfo;

use crate::mail::messages::{escape, platform_label};
use crate::routes::landing::PAGE_STYLE;

const FORM_STYLE: &str = "label{display:block;font-weight:600;margin:1rem 0 0.25rem}input{box-sizing:border-box;width:100%;padding:0.6rem 0.75rem;border:1px solid #c5ccd3;border-radius:0.5rem;font:inherit;color:inherit;background:#fff}input:focus{outline:none;border-color:#1f2933}form{margin:0}button{margin:0.75rem 0.5rem 0 0;padding:0.6rem 1rem;border-radius:0.5rem;border:1px solid #c5ccd3;background:#fff;color:inherit;font:inherit;cursor:pointer}button:hover,button:focus-visible{outline:none;background:#e4e7eb}button.primary{background:#1f2933;color:#fff;border-color:#1f2933}button.primary:hover,button.primary:focus-visible{background:#3e4c59}.error{color:#b42318}.code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:1.5rem;letter-spacing:0.15em}";
const CONTENT_SECURITY_POLICY: &str =
    "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'";

pub struct Field<'a> {
    pub name: &'a str,
    pub value: &'a str,
}

pub struct Input<'a> {
    pub label: &'a str,
    pub name: &'a str,
    pub kind: &'a str,
    pub value: &'a str,
    pub autocomplete: &'a str,
}

pub fn heading(text: &str) -> String {
    format!("<h1>{}</h1>", escape(text))
}

pub fn paragraph(text: &str) -> String {
    format!("<p>{}</p>", escape(text))
}

pub fn error(text: &str) -> String {
    format!("<p class=\"error\" role=\"alert\">{}</p>", escape(text))
}

pub fn code(text: &str) -> String {
    format!("<p class=\"code\">{}</p>", escape(text))
}

pub fn form(
    action: &str,
    hidden: &[Field<'_>],
    input: Option<Input<'_>>,
    button: &str,
    primary: bool,
) -> String {
    let mut html = format!("<form method=\"post\" action=\"{}\">", escape(action));
    for field in hidden {
        html.push_str(&format!(
            "<input type=\"hidden\" name=\"{}\" value=\"{}\">",
            escape(field.name),
            escape(field.value)
        ));
    }
    if let Some(input) = input {
        html.push_str(&format!(
            "<label for=\"{name}\">{label}</label><input id=\"{name}\" type=\"{kind}\" name=\"{name}\" value=\"{value}\" autocomplete=\"{autocomplete}\" spellcheck=\"false\" required>",
            name = escape(input.name),
            label = escape(input.label),
            kind = escape(input.kind),
            value = escape(input.value),
            autocomplete = escape(input.autocomplete),
        ));
    }
    let class = if primary { " class=\"primary\"" } else { "" };
    html.push_str(&format!(
        "<button type=\"submit\"{class}>{}</button></form>",
        escape(button)
    ));
    html
}

pub fn device_label(name: &str, platform: &str) -> String {
    format!("{name} ({})", platform_label(platform))
}

pub fn provider_button(provider: &ProviderInfo) -> String {
    format!("Continue with {}", provider.label)
}

pub fn render(
    status: StatusCode,
    title: &str,
    body: &str,
    cookie: Option<HeaderValue>,
) -> Response {
    let page = format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><meta name=\"referrer\" content=\"no-referrer\"><title>{}</title><style>{PAGE_STYLE}{FORM_STYLE}</style></head><body>{body}</body></html>",
        escape(title)
    );
    let mut response = (status, page).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    headers.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(CONTENT_SECURITY_POLICY),
    );
    if let Some(cookie) = cookie {
        headers.insert(header::SET_COOKIE, cookie);
    }
    response
}

pub fn message(status: StatusCode, title: &str, text: &str) -> Response {
    render(
        status,
        title,
        &format!("{}{}", heading(title), paragraph(text)),
        None,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_from_people_is_escaped_in_pages() {
        let html = form(
            "/auth/x",
            &[Field {
                name: "token",
                value: "a\"><script>",
            }],
            Some(Input {
                label: "Email <address>",
                name: "email",
                kind: "email",
                value: "\"><b>",
                autocomplete: "email",
            }),
            "Go & sign in",
            true,
        );
        assert!(!html.contains("<script>"));
        assert!(!html.contains("<b>"));
        assert!(html.contains("Go &amp; sign in"));
        assert!(html.contains("value=\"&quot;&gt;&lt;b&gt;\""));
        assert!(paragraph("<i>").contains("&lt;i&gt;"));
    }

    #[tokio::test]
    async fn pages_are_never_cached_framed_or_sniffed() {
        let response = message(StatusCode::BAD_REQUEST, "Expired", "Start again.");
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let headers = response.headers();
        assert_eq!(headers[header::CACHE_CONTROL], "no-store");
        assert_eq!(headers[header::X_FRAME_OPTIONS], "DENY");
        assert_eq!(headers[header::REFERRER_POLICY], "no-referrer");
        assert!(headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("<h1>Expired</h1>"));
        assert!(text.contains(PAGE_STYLE));
    }
}
