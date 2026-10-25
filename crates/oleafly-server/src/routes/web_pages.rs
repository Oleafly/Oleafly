use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::capabilities::ProviderInfo;
use oleafly_collab_protocol::page::status;
use url::Url;

use crate::auth::email_link;
use crate::auth::pending::PendingSignIn;
use crate::i18n::{Key, Locale};
use crate::mail::messages::escape;
use crate::mail::notify;
use crate::routes::auth::Finish;
use crate::routes::sign_in_pages::{self, provider_button, Tone};
use crate::state::AppState;
use crate::web_sessions;

fn path_and_query(url: &Url) -> String {
    match url.query() {
        Some(query) => format!("{}?{query}", url.path()),
        None => url.path().to_string(),
    }
}

pub fn sign_in_path(state: &AppState, return_to: &str) -> String {
    let mut url = state.config.endpoint("/web/sign-in");
    url.query_pairs_mut().append_pair("return", return_to);
    path_and_query(&url)
}

pub fn start_path(state: &AppState, provider: &str, return_to: &str) -> String {
    let mut url = state.config.endpoint("/auth/start");
    url.query_pairs_mut()
        .append_pair("flow", "web")
        .append_pair("provider", provider)
        .append_pair("return", return_to);
    path_and_query(&url)
}

fn title(locale: Locale, state: &AppState) -> String {
    locale.fill(Key::SignInTitle, &[("server", &state.config.server_name)])
}

fn link_button(href: &str, label: &str, primary: bool) -> String {
    let class = if primary { "button primary" } else { "button" };
    format!(
        "<a class=\"{class}\" href=\"{}\">{}</a>",
        escape(href),
        escape(label)
    )
}

pub fn sign_in_page(
    locale: Locale,
    state: &AppState,
    providers: &[ProviderInfo],
    return_to: &str,
) -> Response {
    let title = title(locale, state);
    let mut body = sign_in_pages::heading(&title);
    if providers.is_empty() {
        body.push_str(&sign_in_pages::paragraph(locale.text(Key::CodeNoProviders)));
    } else {
        body.push_str(&sign_in_pages::paragraph(locale.text(Key::WebSignInBody)));
        body.push_str("<div class=\"actions\">");
        for (index, provider) in providers.iter().enumerate() {
            body.push_str(&link_button(
                &start_path(state, &provider.id, return_to),
                &provider_button(locale, provider),
                index == 0,
            ));
        }
        body.push_str("</div>");
    }
    sign_in_pages::render(locale, StatusCode::OK, &title, &body, None)
}

fn provider_label(locale: Locale, state: &AppState, provider_id: &str) -> String {
    state
        .providers
        .infos()
        .into_iter()
        .find(|info| info.id == provider_id)
        .map_or_else(
            || locale.text(Key::SomeProvider).to_owned(),
            |info| info.label,
        )
}

pub fn problem(
    locale: Locale,
    state: &AppState,
    status_code: StatusCode,
    heading: &str,
    text_html: &str,
    return_to: &str,
) -> Response {
    let body = format!(
        "{}{}{text_html}<div class=\"actions\">{}</div>",
        status(Tone::Problem),
        sign_in_pages::heading(heading),
        link_button(
            &sign_in_path(state, return_to),
            locale.text(Key::WebTryAgain),
            true
        ),
    );
    sign_in_pages::render(locale, status_code, heading, &body, None)
}

fn refused_text(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    account: Option<&str>,
) -> String {
    let Some(account) = account else {
        return sign_in_pages::paragraph(locale.auth_error(AuthErrorCode::NotAdmitted));
    };
    let account = format!("<strong>{}</strong>", escape(account));
    let server = escape(&state.config.server_name);
    let named = if pending.provider_id == email_link::PROVIDER_ID {
        locale.fill_html(
            Key::RefusedEmailAccount,
            &[("account", &account), ("server", &server)],
        )
    } else {
        let provider = provider_label(locale, state, &pending.provider_id);
        locale.fill_html(
            Key::RefusedProviderAccount,
            &[
                ("provider", &escape(&provider)),
                ("account", &account),
                ("server", &server),
            ],
        )
    };
    format!("<p>{named}</p>")
}

pub(crate) fn concluded(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
    account: Option<&str>,
) -> Response {
    let return_to = web_sessions::return_path(web_sessions::return_of(pending));
    match outcome {
        Ok(Finish::Web(opened)) => {
            if opened.added {
                notify::new_sign_in(
                    state,
                    opened.account_id,
                    opened.device_id,
                    opened.device_name.clone(),
                    web_sessions::PLATFORM.to_string(),
                    state.clock.now_ms(),
                );
            }
            let location = format!("{}{}", state.config.path_prefix(), opened.return_to);
            let mut response = (
                StatusCode::FOUND,
                [
                    (header::LOCATION, location),
                    (header::CACHE_CONTROL, "no-store".to_owned()),
                ],
            )
                .into_response();
            response.headers_mut().insert(
                header::SET_COOKIE,
                web_sessions::cookie(&state.config, &opened.token),
            );
            response
        }
        Ok(Finish::Code(_) | Finish::DeviceApproved | Finish::DeviceGone) => problem(
            locale,
            state,
            StatusCode::BAD_REQUEST,
            locale.text(Key::NotFinishedTitle),
            &sign_in_pages::paragraph(locale.auth_error(AuthErrorCode::InvalidCode)),
            &return_to,
        ),
        Err(AuthErrorCode::NotAdmitted) => problem(
            locale,
            state,
            StatusCode::FORBIDDEN,
            locale.text(Key::RefusedTitle),
            &refused_text(locale, state, pending, account),
            &return_to,
        ),
        Err(code @ AuthErrorCode::SetupCodeInvalid) => problem(
            locale,
            state,
            StatusCode::FORBIDDEN,
            locale.text(Key::RefusedTitle),
            &sign_in_pages::paragraph(locale.auth_error(code)),
            &return_to,
        ),
        Err(code) => problem(
            locale,
            state,
            StatusCode::BAD_REQUEST,
            locale.text(Key::NotFinishedTitle),
            &sign_in_pages::paragraph(locale.auth_error(code)),
            &return_to,
        ),
    }
}
