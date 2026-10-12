use axum::extract::{Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::Response;
use axum::routing::{get, post};
use axum::{Form, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use serde::Deserialize;
use serde_json::json;

use crate::auth::csrf;
use crate::auth::device_code;
use crate::auth::email_link::{self, Link};
use crate::auth::pending::{self, PendingSignIn};
use crate::auth::throttle::{self, Throttle};
use crate::error::ServerError;
use crate::mail::{deliverable, messages, EmailKind, OutgoingEmail};
use crate::members;
use crate::rate_limit::client_key;
use crate::routes::auth::{complete_sign_in, conclude, email_link_available, Finish};
use crate::routes::code_sign_in::{self, TypedCode};
use crate::routes::sign_in_pages::{self, device_label, Field, Input};
use crate::routes::ClientIp;
use crate::security_log::{self, NewSecurityEvent};
use crate::state::AppState;

const INVALID_ADDRESS: &str = "Enter a valid email address, such as ada@uni.edu.";
const TYPE_THE_CODE: &str = "Type the code Oleafly shows on the computer you're signing in on.";
const ONLY_IF_YOU_STARTED: &str = "Only continue if you started this sign-in yourself. If someone gave you a code to type, stop. They're trying to get into your account.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/email-link", post(request_link))
        .route("/auth/email-link/verify", get(show_link).post(use_link))
}

fn title(state: &AppState) -> String {
    format!("Sign in to {}", state.config.server_name)
}

fn path(state: &AppState, route: &str) -> String {
    state.config.endpoint(route).path().to_string()
}

fn address_form(
    state: &AppState,
    pending: &PendingSignIn,
    csrf: &str,
    email: &str,
    problem: Option<&str>,
) -> String {
    let mut body = sign_in_pages::heading(&title(state));
    body.push_str(&sign_in_pages::paragraph(&format!(
        "Enter your email address. We'll send you a link that signs you in to Oleafly on {}.",
        device_label(&pending.device_name, &pending.platform)
    )));
    if let Some(problem) = problem {
        body.push_str(&sign_in_pages::error(problem));
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
            label: "Email address",
            name: "email",
            kind: "email",
            value: email,
            autocomplete: "email",
        }),
        "Email me a link",
        true,
    ));
    body
}

pub(crate) async fn ask_for_address(
    state: &AppState,
    headers: &HeaderMap,
    pending: PendingSignIn,
    now: i64,
) -> Result<Response, ServerError> {
    let csrf = csrf::token(headers);
    let body = address_form(state, &pending, &csrf, "", None);
    state
        .db
        .call(move |conn| pending::insert(conn, &pending, now))
        .await?;
    Ok(sign_in_pages::render(
        StatusCode::OK,
        &title(state),
        &body,
        Some(csrf::cookie(&state.config, &csrf)),
    ))
}

pub(crate) fn page_expired() -> Response {
    sign_in_pages::message(
        StatusCode::FORBIDDEN,
        sign_in_pages::Tone::Problem,
        "This page has expired",
        "It was open for more than an hour, or this browser blocked its cookie. Go back to Oleafly and start signing in again.",
    )
}

fn sign_in_expired() -> Response {
    sign_in_pages::message(
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Problem,
        "This sign-in has expired",
        "Go back to Oleafly and start signing in again.",
    )
}

fn email_sign_in_off() -> Response {
    sign_in_pages::message(
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Notice,
        "Email sign-in is off",
        "This server doesn't sign people in by email any more. Go back to Oleafly and choose another way to sign in.",
    )
}

fn link_problem(link: &Link) -> Response {
    let (title, text) = match link {
        Link::Used => (
            "This link was already used",
            "Each sign-in link works once. Start signing in again in Oleafly to get a new one.",
        ),
        Link::Expired => (
            "This link has expired",
            "Sign-in links work for 15 minutes. Start signing in again in Oleafly to get a new one.",
        ),
        Link::Valid { .. } | Link::Invalid => (
            "This link doesn't work",
            "It may be incomplete, or a newer link replaced it. Start signing in again in Oleafly to get a new one.",
        ),
    };
    sign_in_pages::message(
        StatusCode::BAD_REQUEST,
        sign_in_pages::Tone::Problem,
        title,
        text,
    )
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

async fn request_link(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Form(form): Form<LinkRequest>,
) -> Result<Response, ServerError> {
    if !csrf::verify(&headers, &state.config, &form.csrf) {
        return Ok(page_expired());
    }
    let now = state.clock.now_ms();
    let pending_id = form.pending.clone();
    let Some(pending) = state
        .db
        .call(move |conn| pending::peek(conn, &pending_id, now))
        .await?
        .filter(|pending| pending.provider_id == email_link::PROVIDER_ID)
    else {
        return Ok(sign_in_expired());
    };
    if !email_link_available(&state).await? {
        return Ok(email_sign_in_off());
    }
    let Some(address) = valid_address(&form.email) else {
        let body = address_form(
            &state,
            &pending,
            &form.csrf,
            form.email.trim(),
            Some(INVALID_ADDRESS),
        );
        return Ok(sign_in_pages::render(
            StatusCode::BAD_REQUEST,
            &title(&state),
            &body,
            None,
        ));
    };
    let requester = ip.clone().unwrap_or_else(|| "unknown".to_string());
    let for_link = address.clone();
    let pending_id = pending.id.clone();
    let issued = state
        .db
        .call(move |conn| {
            if lockout(
                conn,
                &format!("email-link-ip:{}", client_key(&requester)),
                email_link::LINKS_PER_IP,
                &requester,
                "ip",
                &ip,
                now,
            )? || lockout(
                conn,
                &format!("email-link:{for_link}"),
                email_link::LINKS_PER_ADDRESS,
                &for_link,
                "address",
                &ip,
                now,
            )? {
                return Ok(None);
            }
            let token = email_link::issue(conn, &pending_id, &for_link, now)?;
            email_link::keep_pending_for_link(conn, &pending_id, now)?;
            Ok(Some(token))
        })
        .await?;
    let Some(token) = issued else {
        return Ok(sign_in_pages::message(
            StatusCode::TOO_MANY_REQUESTS,
            sign_in_pages::Tone::Notice,
            "Too many sign-in emails",
            "Wait 15 minutes, then try again.",
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
        "Open it on this computer within 15 minutes. You can close this tab."
    } else {
        "Open it within 15 minutes and type the code Oleafly shows. You can close this tab."
    };
    let body = format!(
        "{}{}{}",
        sign_in_pages::heading("Check your email"),
        sign_in_pages::paragraph(&format!("We sent a sign-in link to {address}.")),
        sign_in_pages::paragraph(next)
    );
    Ok(sign_in_pages::render(
        StatusCode::OK,
        "Check your email",
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
        return Ok(link_problem(&link));
    }
    let Some(pending) = pending else {
        return Ok(sign_in_expired());
    };
    let csrf = csrf::token(&headers);
    Ok(sign_in_pages::render(
        StatusCode::OK,
        &title(&state),
        &confirm_body(&state, &pending, &token, &csrf, None),
        Some(csrf::cookie(&state.config, &csrf)),
    ))
}

fn confirm_body(
    state: &AppState,
    pending: &PendingSignIn,
    token: &str,
    csrf: &str,
    problem: Option<&str>,
) -> String {
    let mut body = sign_in_pages::heading(&title(state));
    let input = if pending.device_authorization.is_some() {
        body.push_str(&sign_in_pages::paragraph(TYPE_THE_CODE));
        body.push_str(&sign_in_pages::paragraph(ONLY_IF_YOU_STARTED));
        if let Some(problem) = problem {
            body.push_str(&sign_in_pages::error(problem));
        }
        Some(Input {
            label: "Code",
            name: "user_code",
            kind: "text",
            value: "",
            autocomplete: "off",
        })
    } else {
        body.push_str(&sign_in_pages::paragraph(&format!(
            "Finish signing in to Oleafly on {}.",
            device_label(&pending.device_name, &pending.platform)
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
        "Sign in",
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
    headers: HeaderMap,
    Form(form): Form<UseLink>,
) -> Result<Response, ServerError> {
    if !csrf::verify(&headers, &state.config, &form.csrf) {
        return Ok(page_expired());
    }
    if !email_link_available(&state).await? {
        return Ok(email_sign_in_off());
    }
    let now = state.clock.now_ms();
    let token = form.token.clone();
    let max_members = state.config.limits.max_members_per_project;
    let typed = form.user_code.clone();
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
            Ok(Ok((pending, finished)))
        })
        .await?;
    match outcome {
        Ok((pending, finished)) => conclude(&state, &pending, finished),
        Err(Used::Link(link)) => Ok(link_problem(&link)),
        Err(Used::Gone) => Ok(sign_in_expired()),
        Err(Used::CodeGone(pending)) => conclude(&state, &pending, Ok(Finish::DeviceGone)),
        Err(Used::WrongCode(pending)) => Ok(sign_in_pages::render(
            StatusCode::BAD_REQUEST,
            &title(&state),
            &confirm_body(
                &state,
                &pending,
                &form.token,
                &form.csrf,
                Some(code_sign_in::WRONG_CODE),
            ),
            None,
        )),
        Err(Used::LockedOut) => Ok(code_sign_in::locked_out()),
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
