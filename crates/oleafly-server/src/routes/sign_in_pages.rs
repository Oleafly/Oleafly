use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::capabilities::ProviderInfo;
use oleafly_collab_protocol::page::{document_in, status};

use crate::auth::email_link;
use crate::i18n::{Key, Locale};
use crate::mail::messages::{escape, one_line, platform_label};

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
    let class = if primary { " class=\"primary\"" } else { "" };
    form_with(action, hidden, input, button, class)
}

pub fn quiet_form(action: &str, hidden: &[Field<'_>], button: &str) -> String {
    form_with(action, hidden, None, button, " class=\"quiet\"")
}

fn form_with(
    action: &str,
    hidden: &[Field<'_>],
    input: Option<Input<'_>>,
    button: &str,
    class: &str,
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
    html.push_str(&format!(
        "<button type=\"submit\"{class}>{}</button></form>",
        escape(button)
    ));
    html
}

pub const DEVICE_NAME_CHARS: usize = 40;

pub fn device_label(name: &str, platform: &str) -> String {
    format!(
        "{} ({})",
        one_line(name, DEVICE_NAME_CHARS),
        platform_label(platform)
    )
}

pub fn provider_button(locale: Locale, provider: &ProviderInfo) -> String {
    if provider.id == email_link::PROVIDER_ID {
        return locale.text(Key::ContinueWithEmail).to_owned();
    }
    locale.fill(Key::ContinueWith, &[("provider", &provider.label)])
}

pub fn render(
    locale: Locale,
    status: StatusCode,
    title: &str,
    body: &str,
    cookie: Option<HeaderValue>,
) -> Response {
    let page = document_in(locale.tag(), title, body, None);
    let mut response = (status, page).into_response();
    let headers = response.headers_mut();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    );
    headers.insert(header::VARY, HeaderValue::from_static("accept-language"));
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

pub fn message(
    locale: Locale,
    status_code: StatusCode,
    tone: Tone,
    title: &str,
    text: &str,
) -> Response {
    render(
        locale,
        status_code,
        title,
        &format!("{}{}{}", status(tone), heading(title), paragraph(text)),
        None,
    )
}

pub fn notice(
    locale: Locale,
    status_code: StatusCode,
    tone: Tone,
    title: Key,
    text: Key,
) -> Response {
    message(
        locale,
        status_code,
        tone,
        locale.text(title),
        locale.text(text),
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
            Locale::ENGLISH,
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
            let response = message(Locale::ENGLISH, StatusCode::OK, tone, "Title", "Body.");
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
        let response = message(
            Locale::ENGLISH,
            StatusCode::OK,
            Tone::Notice,
            "Sign in",
            "Enter the code.",
        );
        assert_eq!(response.headers()[header::REFERRER_POLICY], "same-origin");
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(text.contains("<meta name=\"referrer\" content=\"same-origin\">"));
        assert!(!text.contains("no-referrer"));
    }

    #[tokio::test]
    async fn pages_name_their_language_and_tell_caches_it_matters() {
        let german = Locale::named("de").expect("german");
        let response = notice(
            german,
            StatusCode::OK,
            Tone::Notice,
            Key::CodeStoppedTitle,
            Key::CodeStoppedBody,
        );
        assert_eq!(response.headers()[header::VARY], "accept-language");
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        let text = String::from_utf8_lossy(&body);
        assert!(
            text.starts_with("<!doctype html><html lang=\"de\">"),
            "{text}"
        );
        assert!(text.contains(&escape(german.text(Key::CodeStoppedTitle))));
        assert!(!text.contains("Sign-in stopped"), "{text}");
    }

    #[test]
    fn a_device_is_named_on_one_short_line() {
        assert_eq!(device_label("Lab PC", "linux"), "Lab PC (Linux)");
        let long = "Confirm your Oleafly access before Friday or lose your projects";
        let label = device_label(long, "macos");
        assert!(label.ends_with(" (macOS)"), "{label}");
        let name = label.trim_end_matches(" (macOS)");
        assert!(name.chars().count() <= DEVICE_NAME_CHARS, "{label}");
        assert_eq!(device_label("Lab\nPC", "windows"), "Lab PC (Windows)");
    }

    #[test]
    fn the_email_option_is_named_in_the_page_language() {
        let email = email_link::provider_info();
        let github = ProviderInfo {
            id: "github".to_owned(),
            kind: oleafly_collab_protocol::capabilities::ProviderKind::Github,
            label: "GitHub".to_owned(),
        };
        let japanese = Locale::named("ja").expect("japanese");
        assert_eq!(
            provider_button(Locale::ENGLISH, &email),
            "Continue with Email"
        );
        assert_eq!(
            provider_button(Locale::ENGLISH, &github),
            "Continue with GitHub"
        );
        assert_eq!(
            provider_button(japanese, &email),
            japanese.text(Key::ContinueWithEmail)
        );
        assert_ne!(provider_button(japanese, &email), "Continue with Email");
        assert!(provider_button(japanese, &github).contains("GitHub"));
        assert_ne!(provider_button(japanese, &github), "Continue with GitHub");
    }
}
