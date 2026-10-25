use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode, Uri};
use axum::response::Response;
use oleafly_collab_protocol::auth::AuthErrorCode;
use oleafly_collab_protocol::crypto::pkce_s256;
use serde::Deserialize;

use crate::auth::{browser_binding, email_link, noting_failure, pending};
use crate::error::ServerError;
use crate::i18n::{Key, Locale, PageLocale};
use crate::routes::auth::{callback_url, email_link_available, found, note_provider_problem};
use crate::routes::{email_sign_in, sign_in_pages, web_pages};
use crate::state::AppState;
use crate::web::WebOn;
use crate::web_sessions;

pub const FLOW: &str = "web";

#[derive(Debug, Default, Deserialize)]
pub struct ReturnQuery {
    #[serde(default, rename = "return")]
    return_to: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
struct StartQuery {
    #[serde(default)]
    provider: String,
    #[serde(default, rename = "return")]
    return_to: Option<String>,
}

pub fn wanted(uri: &Uri) -> bool {
    uri.query().is_some_and(|query| {
        url::form_urlencoded::parse(query.as_bytes())
            .any(|(name, value)| name == "flow" && value == FLOW)
    })
}

pub async fn page(
    _on: WebOn,
    State(state): State<AppState>,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Query(query): Query<ReturnQuery>,
) -> Result<Response, ServerError> {
    let return_to = web_sessions::return_path(query.return_to.as_deref());
    if crate::web::signed_in(&state, &headers).await.is_ok() {
        return Ok(found(&format!("{}{return_to}", state.config.path_prefix())));
    }
    let providers =
        email_link::with_email_link(state.providers.infos(), email_link_available(&state).await?);
    Ok(web_pages::sign_in_page(
        locale, &state, &providers, &return_to,
    ))
}

fn failed(locale: Locale, state: &AppState, code: AuthErrorCode, return_to: &str) -> Response {
    web_pages::problem(
        locale,
        state,
        StatusCode::BAD_REQUEST,
        locale.text(Key::NotFinishedTitle),
        &sign_in_pages::paragraph(locale.auth_error(code)),
        return_to,
    )
}

pub async fn start(
    state: &AppState,
    locale: Locale,
    headers: &HeaderMap,
    uri: &Uri,
) -> Result<Response, ServerError> {
    if !state.config.web {
        return Err(ServerError::NotFound);
    }
    let query = Query::<StartQuery>::try_from_uri(uri)
        .map(|Query(query)| query)
        .unwrap_or_default();
    let return_to = web_sessions::return_path(query.return_to.as_deref());
    let provider = state.providers.get(&query.provider);
    let offered = match provider {
        Some(_) => true,
        None => query.provider == email_link::PROVIDER_ID && email_link_available(state).await?,
    };
    if !offered {
        return Ok(failed(
            locale,
            state,
            AuthErrorCode::UnknownProvider,
            &return_to,
        ));
    }
    let now = state.clock.now_ms();
    let secret = browser_binding::secret(headers, &state.config);
    let pending = web_sessions::pending(
        &query.provider,
        &return_to,
        &web_sessions::browser_name(headers),
        browser_binding::challenge(&secret),
        now,
    );
    let binding = browser_binding::cookie(&state.config, &secret);
    let mut response = match provider {
        None => email_sign_in::ask_for_address(locale, state, headers, pending, now).await?,
        Some(provider) => {
            let callback = callback_url(state, &pending.provider_id);
            let (authorize, detail) = noting_failure(provider.authorize_url(
                &pending.id,
                &callback,
                &pkce_s256(&pending.provider_verifier),
                &pending.provider_nonce,
            ))
            .await;
            let Ok(authorize) = authorize else {
                note_provider_problem(state, &pending.provider_id, detail, now);
                return Ok(failed(
                    locale,
                    state,
                    AuthErrorCode::ProviderFailed,
                    &return_to,
                ));
            };
            state
                .db
                .call(move |conn| pending::insert(conn, &pending, now))
                .await?;
            found(authorize.as_str())
        }
    };
    response.headers_mut().append(header::SET_COOKIE, binding);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_start_that_asks_for_the_web_flow_is_taken_here() {
        let uri = |text: &str| text.parse::<Uri>().unwrap();
        assert!(wanted(&uri("/auth/start?flow=web&provider=github")));
        assert!(wanted(&uri(
            "/auth/start?provider=github&flow=web&return=%2Fweb%2F"
        )));
        assert!(!wanted(&uri("/auth/start?provider=github&redirect_uri=x")));
        assert!(!wanted(&uri("/auth/start?flow=webby")));
        assert!(!wanted(&uri("/auth/start")));
    }
}
