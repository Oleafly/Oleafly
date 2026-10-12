use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::capabilities::ProviderInfo;

use oleafly_collab_protocol::page::{document, status};

use crate::mail::messages::{escape, platform_label};

pub use oleafly_collab_protocol::page::Tone;

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

pub fn next(text: &str) -> String {
    format!("<p class=\"next\">{}</p>", escape(text))
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
    let page = document(title, body, None);
    let mut response = (status, page).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("same-origin"),
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

pub fn message(status_code: StatusCode, tone: Tone, title: &str, text: &str) -> Response {
    render(
        status_code,
        title,
        &format!("{}{}{}", status(tone), heading(title), paragraph(text)),
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
        let response = message(
            StatusCode::BAD_REQUEST,
            Tone::Problem,
            "Expired",
            "Start again.",
        );
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let headers = response.headers();
        assert_eq!(headers[header::CACHE_CONTROL], "no-store");
        assert_eq!(headers[header::X_FRAME_OPTIONS], "DENY");
        assert!(headers[header::CONTENT_SECURITY_POLICY]
            .to_str()
            .unwrap()
            .contains("frame-ancestors 'none'"));
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("<h1>Expired</h1>"));
        assert!(text.contains(oleafly_collab_protocol::page::STYLE));
    }

    #[tokio::test]
    async fn pages_wear_the_oleafly_brand_and_show_how_things_went() {
        for (tone, class) in [
            (Tone::Success, "status success"),
            (Tone::Problem, "status problem"),
            (Tone::Notice, "status notice"),
        ] {
            let response = message(StatusCode::OK, tone, "Title", "Body.");
            let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
                .await
                .unwrap();
            let text = String::from_utf8_lossy(&body);
            assert!(text.contains("<div class=\"brand\"><svg"), "{text}");
            assert!(text.contains(class), "{text}");
            assert!(text.contains("<h1>Title</h1>"));
            assert!(text.contains("radial-gradient("));
        }
    }

    #[tokio::test]
    async fn pages_let_their_own_forms_name_the_server_but_tell_no_one_else() {
        let response = message(StatusCode::OK, Tone::Notice, "Sign in", "Enter the code.");
        assert_eq!(response.headers()[header::REFERRER_POLICY], "same-origin");
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("<meta name=\"referrer\" content=\"same-origin\">"));
        assert!(!text.contains("no-referrer"));
    }
}
