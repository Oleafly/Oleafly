use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Form, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::page::status;
use serde::Deserialize;
use serde_json::json;

use crate::auth::csrf;
use crate::auth::device_code;
use crate::auth::email_link::{self, Link};
use crate::auth::pending::{self, PendingSignIn};
use crate::auth::throttle::{self, Throttle};
use crate::error::ServerError;
use crate::i18n::{Key, Locale, PageLocale};
use crate::mail::{deliverable, messages, EmailKind, OutgoingEmail};
use crate::members;
use crate::rate_limit::client_key;
use crate::routes::auth::{
    complete_sign_in, conclude, conclude_naming, email_link_available, Finish,
};
use crate::routes::code_sign_in::{self, TypedCode};
use crate::routes::sign_in_pages::{self, device_label, Field, Input};
use crate::routes::ClientIp;
use crate::security_log::{self, NewSecurityEvent};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/email-link", post(request_link))
        .route("/auth/email-link/verify", get(show_link).post(use_link))
}

fn title(locale: Locale, state: &AppState) -> String {
    locale.fill(Key::SignInTitle, &[("server", &state.config.server_name)])
}

fn path(state: &AppState, route: &str) -> String {
    state.config.endpoint(route).path().to_string()
}

fn address_form(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    csrf: &str,
    email: &str,
    problem: Option<Key>,
) -> String {
    let mut body = sign_in_pages::heading(&title(locale, state));
    body.push_str(&sign_in_pages::paragraph(&locale.fill(
        Key::EmailEnterAddress,
        &[(
            "device",
            &device_label(&pending.device_name, &pending.platform),
        )],
    )));
    if let Some(problem) = problem {
        body.push_str(&sign_in_pages::error(locale.text(problem)));
    }
    body.push_str(&sign_in_pages::form(
        &path(state, "/auth/email-link"),
        &[
            Field {
                name: "pending",
                value: &pending.id,
            },
            Field {
                name: "csrf",
                value: csrf,
            },
        ],
        Some(Input {
            label: locale.text(Key::EmailAddressLabel),
            name: "email",
            kind: "email",
            value: email,
            autocomplete: "email",
        }),
        locale.text(Key::EmailSend),
        true,
    ));
    body
}

pub(crate) async fn ask_for_address(
    locale: Locale,
    state: &AppState,
    headers: &HeaderMap,
    pending: PendingSignIn,
    now: i64,
) -> Result<Response, ServerError> {
    let csrf = csrf::token(headers);
    let body = address_form(locale, state, &pending, &csrf, "", None);
    state
        .db
        .call(move |conn| pending::insert(conn, &pending, now))
        .await?;
    Ok(sign_in_pages::render(
        locale,
        StatusCode::OK,
        &title(locale, state),
        &body,
        Some(csrf::cookie(&state.config, &csrf)),
    ))
}

pub(crate) fn page_expired(locale: Locale) -> Response {
    sign_in_pages::notice(
        locale,
        StatusCode::FORBIDDEN,
        sign_in_pages::Tone::Problem,
        Key::PageExpiredTitle,
        Key::PageExpiredBody,
    )
}

fn sign_in_expired(locale: Locale) -> Response {
    sign_in_pages::notice(
        locale,
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Problem,
        Key::SignInExpiredTitle,
        Key::SignInExpiredBody,
    )
}

fn email_sign_in_off(locale: Locale) -> Response {
    sign_in_pages::notice(
        locale,
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Notice,
        Key::EmailOffTitle,
        Key::EmailOffBody,
    )
}

fn link_problem(locale: Locale, link: &Link) -> Response {
    let (title, text) = match link {
        Link::Used => (Key::LinkUsedTitle, Key::LinkUsedBody),
        Link::Expired => (Key::LinkExpiredTitle, Key::LinkExpiredBody),
        Link::Valid { .. } | Link::Invalid => (Key::LinkInvalidTitle, Key::LinkInvalidBody),
    };
    sign_in_pages::notice(
        locale,
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Problem,
        title,
        text,
    )
}

fn on_a_phone_or_tablet(headers: &HeaderMap) -> bool {
    headers
        .get(header::USER_AGENT)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|agent| {
            ["iPhone", "iPad", "iPod", "Android"]
                .iter()
                .any(|mark| agent.contains(mark))
        })
}

fn needs_the_computer(pending: &PendingSignIn, headers: &HeaderMap) -> bool {
    let desktop = matches!(
        pending.platform.trim().to_ascii_lowercase().as_str(),
        "macos" | "windows" | "linux"
    );
    pending.device_authorization.is_none() && desktop && on_a_phone_or_tablet(headers)
}

fn open_on_the_computer(locale: Locale, state: &AppState, pending: &PendingSignIn) -> Response {
    let device = device_label(&pending.device_name, &pending.platform);
    let title = title(locale, state);
    let body = format!(
        "{}{}{}",
        status(sign_in_pages::Tone::Notice),
        sign_in_pages::heading(&title),
        sign_in_pages::paragraph(&locale.fill(Key::EmailWrongDevice, &[("device", &device)])),
    );
    sign_in_pages::render(locale, StatusCode::OK, &title, &body, None)
}

fn valid_address(raw: &str) -> Option<String> {
    let address = members::normalize_email(raw)?;
    (address.chars().count() <= email_link::MAX_EMAIL_CHARS
        && deliverable(std::slice::from_ref(&address)) == [address.clone()])
    .then_some(address)
}

fn link_email(address: String, content: messages::Content, now: i64) -> OutgoingEmail {
    OutgoingEmail::new(EmailKind::SignInLink, vec![address], content)
        .expiring_at(now + email_link::LINK_TTL_MS)
}

fn verify_link(state: &AppState, token: &str) -> String {
    let mut url = state.config.endpoint("/auth/email-link/verify");
    url.query_pairs_mut().append_pair("token", token);
    url.to_string()
}

#[derive(Deserialize)]
struct LinkRequest {
    #[serde(default)]
    pending: String,
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    email: String,
}

fn lockout(
    conn: &rusqlite::Connection,
    key: &str,
    limit: u32,
    target: &str,
    which: &str,
    ip: &Option<String>,
    now: i64,
) -> Result<bool, ServerError> {
    match throttle::hit(conn, key, limit, email_link::WINDOW_MS, now)? {
        Throttle::Allowed => Ok(false),
        Throttle::LockedOut { first } => {
            if first {
                security_log::record(
                    conn,
                    now,
                    NewSecurityEvent {
                        actor: None,
                        kind: SecurityEventKind::SignInRefused,
                        target: Some(target.to_string()),
                        ip: ip.clone(),
                        detail: json!({
                            "provider": email_link::PROVIDER_ID,
                            "reason": "locked_out",
                            "limit": which
                        }),
                    },
                )?;
            }
            Ok(true)
        }
    }
}

fn server_lockout(
    conn: &rusqlite::Connection,
    limit: u32,
    ip: &Option<String>,
    now: i64,
) -> Result<bool, ServerError> {
    match throttle::hit(
        conn,
        email_link::SERVER_LIMIT_KEY,
        limit,
        email_link::HOUR_MS,
        now,
    )? {
        Throttle::Allowed => Ok(false),
        Throttle::LockedOut { first } => {
            if first {
                tracing::warn!(
                    "This server sent {limit} sign-in emails within an hour, so it sends no more until the hour is over."
                );
                security_log::record(
                    conn,
                    now,
                    NewSecurityEvent {
                        actor: None,
                        kind: SecurityEventKind::SignInRefused,
                        target: None,
                        ip: ip.clone(),
                        detail: json!({
                            "provider": email_link::PROVIDER_ID,
                            "reason": "locked_out",
                            "limit": "server",
                            "per_hour": limit
                        }),
                    },
                )?;
            }
            Ok(true)
        }
    }
}

async fn request_link(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Form(form): Form<LinkRequest>,
) -> Result<Response, ServerError> {
    if !csrf::verify(&headers, &state.config, &form.csrf) {
        return Ok(page_expired(locale));
    }
    let now = state.clock.now_ms();
    let pending_id = form.pending.clone();
    let Some(pending) = state
        .db
        .call(move |conn| pending::peek(conn, &pending_id, now))
        .await?
        .filter(|pending| pending.provider_id == email_link::PROVIDER_ID)
    else {
        return Ok(sign_in_expired(locale));
    };
    if !email_link_available(&state).await? {
        return Ok(email_sign_in_off(locale));
    }
    let Some(address) = valid_address(&form.email) else {
        let body = address_form(
            locale,
            &state,
            &pending,
            &form.csrf,
            form.email.trim(),
            Some(Key::EmailInvalidAddress),
        );
        return Ok(sign_in_pages::render(
            locale,
            StatusCode::BAD_REQUEST,
            &title(locale, &state),
            &body,
            None,
        ));
    };
    let requester = ip.clone().unwrap_or_else(|| "unknown".to_string());
    let for_link = address.clone();
    let mailbox = email_link::mailbox(&address);
    let pending_id = pending.id.clone();
    let limits = state.config.sign_in;
    let issued = state
        .db
        .call(move |conn| {
            if lockout(
                conn,
                &format!("email-link-ip:{}", client_key(&requester)),
                limits.email_links_per_ip,
                &requester,
                "ip",
                &ip,
                now,
            )? || lockout(
                conn,
                &format!("email-link:{mailbox}"),
                limits.email_links_per_address,
                &for_link,
                "address",
                &ip,
                now,
            )? || server_lockout(conn, limits.email_links_per_hour, &ip, now)?
            {
                return Ok(None);
            }
            let token = email_link::issue(conn, &pending_id, &for_link, now)?;
            email_link::keep_pending_for_link(conn, &pending_id, now)?;
            Ok(Some(token))
        })
        .await?;
    let Some(token) = issued else {
        return Ok(sign_in_pages::notice(
            locale,
            StatusCode::TOO_MANY_REQUESTS,
            sign_in_pages::Tone::Notice,
            Key::TooManyEmailsTitle,
            Key::TooManyEmailsBody,
        ));
    };
    let same_device = pending.device_authorization.is_none();
    let content = messages::sign_in_link(
        &state.config.server_name,
        &verify_link(&state, &token),
        same_device,
    );
    state
        .mailer
        .enqueue(link_email(address.clone(), content, now));
    let next = if same_device {
        Key::EmailSentSameDevice
    } else {
        Key::EmailSentOtherDevice
    };
    let sent = locale.text(Key::EmailSentTitle);
    let body = format!(
        "{}{}{}",
        sign_in_pages::heading(sent),
        sign_in_pages::paragraph(&locale.fill(Key::EmailSentBody, &[("address", &address)])),
        sign_in_pages::paragraph(locale.text(next))
    );
    Ok(sign_in_pages::render(
        locale,
        StatusCode::OK,
        sent,
        &body,
        None,
    ))
}

#[derive(Deserialize)]
struct TokenQuery {
    token: Option<String>,
}

async fn show_link(
    State(state): State<AppState>,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Result<Response, ServerError> {
    let token = query.token.unwrap_or_default();
    let now = state.clock.now_ms();
    let checked = token.clone();
    let (link, pending) = state
        .db
        .call(move |conn| {
            let link = email_link::inspect(conn, &checked, now)?;
            let pending = match &link {
                Link::Valid { pending_id, .. } => pending::peek(conn, pending_id, now)?,
                _ => None,
            };
            Ok((link, pending))
        })
        .await?;
    if !matches!(link, Link::Valid { .. }) {
        return Ok(link_problem(locale, &link));
    }
    let Some(pending) = pending else {
        return Ok(sign_in_expired(locale));
    };
    if needs_the_computer(&pending, &headers) {
        return Ok(open_on_the_computer(locale, &state, &pending));
    }
    let csrf = csrf::token(&headers);
    Ok(sign_in_pages::render(
        locale,
        StatusCode::OK,
        &title(locale, &state),
        &confirm_body(locale, &state, &pending, &token, &csrf, None),
        Some(csrf::cookie(&state.config, &csrf)),
    ))
}

fn confirm_body(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    token: &str,
    csrf: &str,
    problem: Option<Key>,
) -> String {
    let mut body = sign_in_pages::heading(&title(locale, state));
    let input = if pending.device_authorization.is_some() {
        body.push_str(&sign_in_pages::paragraph(locale.text(Key::EmailTypeCode)));
        body.push_str(&sign_in_pages::paragraph(locale.text(Key::EmailOnlyIfYou)));
        if let Some(problem) = problem {
            body.push_str(&sign_in_pages::error(locale.text(problem)));
        }
        Some(Input {
            label: locale.text(Key::CodeLabel),
            name: "user_code",
            kind: "text",
            value: "",
            autocomplete: "off",
        })
    } else {
        body.push_str(&sign_in_pages::paragraph(&locale.fill(
            Key::EmailFinish,
            &[(
                "device",
                &device_label(&pending.device_name, &pending.platform),
            )],
        )));
        None
    };
    body.push_str(&sign_in_pages::form(
        &path(state, "/auth/email-link/verify"),
        &[
            Field {
                name: "token",
                value: token,
            },
            Field {
                name: "csrf",
                value: csrf,
            },
        ],
        input,
        locale.text(Key::SignInButton),
        true,
    ));
    body
}

#[derive(Deserialize)]
struct UseLink {
    #[serde(default)]
    token: String,
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    user_code: String,
}

enum Used {
    Link(Link),
    Gone,
    WrongDevice(PendingSignIn),
    CodeGone(PendingSignIn),
    WrongCode(PendingSignIn),
    LockedOut,
}

fn typed_code_problem(
    conn: &rusqlite::Connection,
    pending: PendingSignIn,
    typed: &str,
    ip: &Option<String>,
    now: i64,
) -> Result<Option<Used>, ServerError> {
    let Some(id) = pending.device_authorization.clone() else {
        return Ok(None);
    };
    if device_code::find_pending(conn, &id, now)?.is_none() {
        return Ok(Some(Used::CodeGone(pending)));
    }
    Ok(
        match code_sign_in::check_typed_code(conn, ip, &id, typed, now)? {
            TypedCode::Right => None,
            TypedCode::Wrong => Some(Used::WrongCode(pending)),
            TypedCode::LockedOut => Some(Used::LockedOut),
        },
    )
}

async fn use_link(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Form(form): Form<UseLink>,
) -> Result<Response, ServerError> {
    if !csrf::verify(&headers, &state.config, &form.csrf) {
        return Ok(page_expired(locale));
    }
    if !email_link_available(&state).await? {
        return Ok(email_sign_in_off(locale));
    }
    let now = state.clock.now_ms();
    let token = form.token.clone();
    let max_members = state.config.limits.max_members_per_project;
    let typed = form.user_code.clone();
    let phone = headers.clone();
    let outcome = state
        .db
        .call(move |conn| {
            let pending_id = match email_link::inspect(conn, &token, now)? {
                Link::Valid { pending_id, .. } => pending_id,
                other => return Ok(Err(Used::Link(other))),
            };
            let Some(pending) = pending::peek(conn, &pending_id, now)?
                .filter(|pending| pending.provider_id == email_link::PROVIDER_ID)
            else {
                return Ok(Err(Used::Gone));
            };
            if needs_the_computer(&pending, &phone) {
                return Ok(Err(Used::WrongDevice(pending)));
            }
            if let Some(problem) = typed_code_problem(conn, pending, &typed, &ip, now)? {
                return Ok(Err(problem));
            }
            let (pending_id, email) = match email_link::consume(conn, &token, now)? {
                Link::Valid { pending_id, email } => (pending_id, email),
                other => return Ok(Err(Used::Link(other))),
            };
            let Some(pending) = pending::take(conn, &pending_id, now)?
                .filter(|pending| pending.provider_id == email_link::PROVIDER_ID)
            else {
                return Ok(Err(Used::Gone));
            };
            email_link::link_existing_account(conn, &email, now)?;
            let finished = complete_sign_in(
                conn,
                &email_link::identity(&email),
                &pending,
                ip,
                max_members,
                now,
            )?;
            Ok(Ok((pending, finished, email)))
        })
        .await?;
    match outcome {
        Ok((pending, finished, email)) => {
            conclude_naming(locale, &state, &pending, finished, Some(&email))
        }
        Err(Used::Link(link)) => Ok(link_problem(locale, &link)),
        Err(Used::Gone) => Ok(sign_in_expired(locale)),
        Err(Used::WrongDevice(pending)) => Ok(open_on_the_computer(locale, &state, &pending)),
        Err(Used::CodeGone(pending)) => conclude(locale, &state, &pending, Ok(Finish::DeviceGone)),
        Err(Used::WrongCode(pending)) => Ok(sign_in_pages::render(
            locale,
            StatusCode::BAD_REQUEST,
            &title(locale, &state),
            &confirm_body(
                locale,
                &state,
                &pending,
                &form.token,
                &form.csrf,
                Some(Key::CodeWrong),
            ),
            None,
        )),
        Err(Used::LockedOut) => Ok(code_sign_in::locked_out(locale)),
    }
}

#[cfg(test)]
mod tests {
    use super::{link_email, valid_address};
    use crate::auth::email_link::LINK_TTL_MS;
    use crate::mail::{messages, EmailKind};

    #[test]
    fn the_link_email_is_dropped_once_the_link_it_carries_has_expired() {
        let content = messages::sign_in_link("Lab", "https://collab.test/verify", true);
        let email = link_email("ada@uni.edu".to_string(), content, 1_000);
        assert_eq!(email.kind, EmailKind::SignInLink);
        assert_eq!(email.to, ["ada@uni.edu"]);
        assert_eq!(email.expires_at, Some(1_000 + LINK_TTL_MS));
    }

    #[test]
    fn only_deliverable_addresses_are_accepted_and_they_are_normalized() {
        assert_eq!(
            valid_address("  Ada@Uni.EDU ").as_deref(),
            Some("ada@uni.edu")
        );
        for bad in [
            "not an address",
            "ada@",
            "@uni.edu",
            "ada@localhost",
            "1234+ada@users.noreply.github.com",
        ] {
            assert_eq!(valid_address(bad), None, "{bad}");
        }
        let long = format!("{}@uni.edu", "a".repeat(250));
        assert_eq!(valid_address(&long), None);
    }
}
