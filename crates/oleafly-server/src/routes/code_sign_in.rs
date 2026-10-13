use axum::extract::rejection::JsonRejection;
use axum::extract::{Query, State};
use axum::http::{header, HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Form, Json, Router};
use oleafly_collab_protocol::admin::{MemberStatus, SecurityEventKind};
use oleafly_collab_protocol::auth::{
    AuthErrorCode, ChallengePurpose, DeviceCodeRequest, DeviceCodeResponse, DevicePoll,
    DeviceTokenRequest,
};
use oleafly_collab_protocol::crypto::{b64url_decode, pkce_s256};
use oleafly_collab_protocol::ids::ServerId;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;

use crate::auth::device_code::{self, Authorization, NewAuthorization, Pace, Status};
use crate::auth::email_link;
use crate::auth::pending::{self, PendingSignIn, PENDING_TTL_MS};
use crate::auth::throttle::{self, Throttle};
use crate::auth::{browser_binding, csrf, db_error, devices, nonce, refresh};
use crate::error::ServerError;
use crate::mail::messages::escape;
use crate::mail::notify;
use crate::members;
use crate::rate_limit::client_key;
use crate::routes::auth::{checked_setup_code, email_link_available, Finish};
use crate::routes::email_sign_in::{self, page_expired};
use crate::routes::sign_in_pages::{
    self, device_label, heading, next, paragraph, provider_button, Field, Input, Tone,
};
use crate::routes::{json_body, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::state::AppState;
use crate::tokens::random_token;
use oleafly_collab_protocol::page::status;

const INCOMPLETE: &str = "This sign-in request is incomplete. Start again in Oleafly.";
pub(crate) const WRONG_CODE: &str =
    "That code is wrong or has expired. Check the code Oleafly shows and try again.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/device/code", post(issue))
        .route("/auth/device/token", post(token))
        .route("/auth/device", get(entry).post(check))
        .route("/auth/device/continue", post(continue_with))
        .route("/auth/device/deny", post(deny))
}

fn title(state: &AppState) -> String {
    format!("Sign in to {}", state.config.server_name)
}

fn path(state: &AppState, route: &str) -> String {
    state.config.endpoint(route).path().to_string()
}

fn verification_uri(state: &AppState) -> String {
    state.config.endpoint("/auth/device").to_string()
}

fn well_formed(request: &DeviceCodeRequest) -> bool {
    let key = b64url_decode(&request.device_public_key).is_ok_and(|bytes| bytes.len() == 32);
    let name = !request.device_name.trim().is_empty() && request.device_name.chars().count() <= 100;
    let platform = !request.platform.trim().is_empty() && request.platform.chars().count() <= 40;
    key && name && platform
}

fn log_lockout(
    conn: &Connection,
    target: &str,
    reason: &str,
    ip: &Option<String>,
    now: i64,
) -> Result<(), ServerError> {
    security_log::record(
        conn,
        now,
        NewSecurityEvent {
            actor: None,
            kind: SecurityEventKind::SignInRefused,
            target: Some(target.to_string()),
            ip: ip.clone(),
            detail: json!({ "flow": "device_code", "reason": reason, "limit": "ip" }),
        },
    )?;
    Ok(())
}

async fn issue(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    body: Result<Json<DeviceCodeRequest>, JsonRejection>,
) -> Result<Json<DeviceCodeResponse>, ServerError> {
    let request = json_body(body)?;
    if !well_formed(&request) {
        return Err(ServerError::BadRequest(INCOMPLETE.to_string()));
    }
    let setup_code_hash = checked_setup_code(&state, request.setup_code.as_deref())
        .await?
        .map_err(ServerError::Auth)?;
    let now = state.clock.now_ms();
    let new = NewAuthorization {
        device_public_key: request.device_public_key.clone(),
        device_name: request.device_name.trim().to_string(),
        platform: request.platform.trim().to_string(),
        setup_code_hash,
    };
    let requester = ip.clone().unwrap_or_else(|| "unknown".to_string());
    let per_ip = state.config.sign_in.device_codes_per_ip;
    let issued = state
        .db
        .call(move |conn| {
            let key = format!("device-codes-ip:{}", client_key(&requester));
            if let Throttle::LockedOut { first } =
                throttle::hit(conn, &key, per_ip, device_code::WINDOW_MS, now)?
            {
                if first {
                    log_lockout(conn, &requester, "locked_out", &ip, now)?;
                }
                return Ok(None);
            }
            device_code::create(conn, &new, now).map(Some)
        })
        .await?
        .ok_or(ServerError::RateLimited)?;
    let verification = verification_uri(&state);
    let mut complete = state.config.endpoint("/auth/device");
    complete
        .query_pairs_mut()
        .append_pair("code", &issued.user_code);
    Ok(Json(DeviceCodeResponse {
        device_code: issued.device_code,
        user_code: issued.user_code,
        verification_uri: verification,
        verification_uri_complete: complete.to_string(),
        expires_in: u64::try_from(device_code::CODE_TTL_MS / 1000).unwrap_or(600),
        interval: device_code::INTERVAL_SECS,
    }))
}

type Added = Option<(
    oleafly_collab_protocol::ids::AccountId,
    oleafly_collab_protocol::ids::DeviceId,
    String,
    String,
)>;

fn redeem(
    conn: &mut Connection,
    request: &DeviceTokenRequest,
    server_id: ServerId,
    ip: Option<String>,
    now: i64,
) -> Result<(DevicePoll, Added), ServerError> {
    if !nonce::consume(conn, &request.nonce, now)? {
        return Err(ServerError::Auth(AuthErrorCode::ExpiredNonce));
    }
    let tx = conn.transaction().map_err(db_error)?;
    let authorization = device_code::find_by_device_code(&tx, &request.device_code)?
        .ok_or(ServerError::Auth(AuthErrorCode::InvalidCode))?;
    let signed = devices::signature_valid(
        &authorization.device_public_key,
        ChallengePurpose::Token,
        server_id,
        &request.nonce,
        &request.signature,
    );
    if !signed {
        return Err(ServerError::Auth(AuthErrorCode::InvalidSignature));
    }
    let outcome = match authorization.status {
        Status::Used => return Err(ServerError::Auth(AuthErrorCode::InvalidCode)),
        Status::Refused => return Err(ServerError::Auth(AuthErrorCode::NotAdmitted)),
        Status::Denied => (DevicePoll::Denied, None),
        _ if authorization.expires_at <= now => (DevicePoll::Expired, None),
        Status::Pending => match device_code::record_poll(&tx, &authorization.id, now)? {
            Pace::Steady { interval } => (DevicePoll::Pending { interval }, None),
            Pace::TooFast { interval } => (DevicePoll::SlowDown { interval }, None),
        },
        Status::Approved => approved(&tx, &authorization, ip, now)?,
    };
    tx.commit().map_err(db_error)?;
    Ok(outcome)
}

fn approved(
    tx: &Connection,
    authorization: &Authorization,
    ip: Option<String>,
    now: i64,
) -> Result<(DevicePoll, Added), ServerError> {
    let account = authorization.account_id.ok_or_else(|| {
        ServerError::Internal("an approved sign-in code has no account".to_string())
    })?;
    if !matches!(
        members::account_status(tx, account)?,
        Some(MemberStatus::Active)
    ) {
        return Err(ServerError::Auth(AuthErrorCode::NotAdmitted));
    }
    if !device_code::mark_used(tx, &authorization.id)? {
        return Err(ServerError::Auth(AuthErrorCode::InvalidCode));
    }
    let registered = devices::register(
        tx,
        account,
        &authorization.device_public_key,
        &authorization.device_name,
        &authorization.platform,
        now,
    )?;
    if registered.added {
        security_log::record(
            tx,
            now,
            NewSecurityEvent {
                actor: Some(account),
                kind: SecurityEventKind::DeviceAdded,
                target: Some(registered.device_id.to_string()),
                ip,
                detail: json!({
                    "name": authorization.device_name,
                    "platform": authorization.platform,
                    "device_code": true
                }),
            },
        )?;
    }
    let tokens = refresh::issue_session(tx, account, registered.device_id, now)?;
    let added = registered.added.then(|| {
        (
            account,
            registered.device_id,
            authorization.device_name.clone(),
            authorization.platform.clone(),
        )
    });
    Ok((DevicePoll::Approved { tokens }, added))
}

async fn token(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    body: Result<Json<DeviceTokenRequest>, JsonRejection>,
) -> Result<Json<DevicePoll>, ServerError> {
    let request = json_body(body)?;
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    let (poll, added) = state
        .db
        .call(move |conn| redeem(conn, &request, server_id, ip, now))
        .await?;
    if let Some((account, device, name, platform)) = added {
        notify::new_sign_in(&state, account, device, name, platform, now);
    }
    Ok(Json(poll))
}

fn entry_body(state: &AppState, csrf: &str, code: &str, problem: Option<&str>) -> String {
    let mut body = sign_in_pages::heading(&title(state));
    body.push_str(&sign_in_pages::paragraph(
        "Enter the code that Oleafly shows on the device you're signing in on.",
    ));
    if let Some(problem) = problem {
        body.push_str(&sign_in_pages::error(problem));
    }
    body.push_str(&sign_in_pages::form(
        &path(state, "/auth/device"),
        &[Field {
            name: "csrf",
            value: csrf,
        }],
        Some(Input {
            label: "Code",
            name: "user_code",
            kind: "text",
            value: code,
            autocomplete: "off",
        }),
        "Continue",
        true,
    ));
    body
}

#[derive(Deserialize)]
struct EntryQuery {
    code: Option<String>,
}

async fn entry(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<EntryQuery>,
) -> Response {
    let csrf = csrf::token(&headers);
    let code = query
        .code
        .as_deref()
        .and_then(device_code::normalize_user_code)
        .unwrap_or_default();
    sign_in_pages::render(
        StatusCode::OK,
        &title(&state),
        &entry_body(&state, &csrf, &code, None),
        Some(csrf::cookie(&state.config, &csrf)),
    )
}

#[derive(Deserialize)]
struct CodeForm {
    #[serde(default)]
    csrf: String,
    #[serde(default)]
    user_code: String,
    #[serde(default)]
    provider: String,
}

enum Lookup {
    Found(Authorization),
    Wrong,
    LockedOut,
}

fn requester(ip: &Option<String>) -> String {
    ip.clone().unwrap_or_else(|| "unknown".to_string())
}

fn guess_key(ip: &Option<String>) -> String {
    format!("device-code-guess-ip:{}", client_key(&requester(ip)))
}

fn guessing_locked_out(
    conn: &Connection,
    ip: &Option<String>,
    now: i64,
) -> Result<bool, ServerError> {
    match throttle::check(conn, &guess_key(ip), device_code::WRONG_CODES_PER_IP, now)? {
        Throttle::Allowed => Ok(false),
        Throttle::LockedOut { first } => {
            if first {
                log_lockout(conn, &requester(ip), "locked_out", ip, now)?;
            }
            Ok(true)
        }
    }
}

fn count_wrong_guess(conn: &Connection, ip: &Option<String>, now: i64) -> Result<(), ServerError> {
    throttle::hit(
        conn,
        &guess_key(ip),
        device_code::WRONG_CODES_PER_IP,
        device_code::WINDOW_MS,
        now,
    )?;
    Ok(())
}

async fn lookup(state: &AppState, ip: Option<String>, typed: &str) -> Result<Lookup, ServerError> {
    let now = state.clock.now_ms();
    let typed = typed.to_string();
    state
        .db
        .call(move |conn| {
            if guessing_locked_out(conn, &ip, now)? {
                return Ok(Lookup::LockedOut);
            }
            match device_code::find_pending_by_user_code(conn, &typed, now)? {
                Some(authorization) => Ok(Lookup::Found(authorization)),
                None => {
                    count_wrong_guess(conn, &ip, now)?;
                    Ok(Lookup::Wrong)
                }
            }
        })
        .await
}

pub(crate) enum TypedCode {
    Right,
    Wrong,
    LockedOut,
}

pub(crate) fn check_typed_code(
    conn: &Connection,
    ip: &Option<String>,
    authorization_id: &str,
    typed: &str,
    now: i64,
) -> Result<TypedCode, ServerError> {
    if guessing_locked_out(conn, ip, now)? {
        return Ok(TypedCode::LockedOut);
    }
    if device_code::user_code_matches(conn, authorization_id, typed, now)? {
        return Ok(TypedCode::Right);
    }
    count_wrong_guess(conn, ip, now)?;
    Ok(TypedCode::Wrong)
}

pub(crate) fn locked_out() -> Response {
    sign_in_pages::message(
        StatusCode::TOO_MANY_REQUESTS,
        sign_in_pages::Tone::Notice,
        "Too many wrong codes",
        "Wait 10 minutes, then try again.",
    )
}

async fn found_or_page(
    state: &AppState,
    ip: Option<String>,
    headers: &HeaderMap,
    form: &CodeForm,
) -> Result<Result<Authorization, Response>, ServerError> {
    if !csrf::verify(headers, &state.config, &form.csrf) {
        return Ok(Err(page_expired()));
    }
    Ok(match lookup(state, ip, &form.user_code).await? {
        Lookup::Found(authorization) => Ok(authorization),
        Lookup::LockedOut => Err(locked_out()),
        Lookup::Wrong => {
            let typed = form.user_code.trim().chars().take(32).collect::<String>();
            Err(sign_in_pages::render(
                StatusCode::BAD_REQUEST,
                &title(state),
                &entry_body(state, &form.csrf, &typed, Some(WRONG_CODE)),
                None,
            ))
        }
    })
}

async fn check(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let authorization = match found_or_page(&state, ip, &headers, &form).await? {
        Ok(authorization) => authorization,
        Err(page) => return Ok(page),
    };
    let user_code = device_code::normalize_user_code(&form.user_code).unwrap_or_default();
    let device = device_label(&authorization.device_name, &authorization.platform);
    let mut body = sign_in_pages::heading(&title(&state));
    body.push_str(&sign_in_pages::paragraph(&format!(
        "Oleafly on {device} asked to sign in with this code:"
    )));
    body.push_str(&sign_in_pages::code(&user_code));
    body.push_str(&sign_in_pages::paragraph(
        "Only continue if you started this sign-in yourself, on that device.",
    ));
    let runtime_email = email_link_available(&state).await?;
    let providers = email_link::with_email_link(state.providers.infos(), runtime_email);
    if providers.is_empty() {
        body.push_str(&sign_in_pages::paragraph(
            "This server has no way to sign in yet. Ask its admin to set one up.",
        ));
    }
    for provider in &providers {
        body.push_str(&sign_in_pages::form(
            &path(&state, "/auth/device/continue"),
            &[
                Field {
                    name: "csrf",
                    value: &form.csrf,
                },
                Field {
                    name: "user_code",
                    value: &user_code,
                },
                Field {
                    name: "provider",
                    value: &provider.id,
                },
            ],
            None,
            &provider_button(provider),
            true,
        ));
    }
    body.push_str(&sign_in_pages::form(
        &path(&state, "/auth/device/deny"),
        &[
            Field {
                name: "csrf",
                value: &form.csrf,
            },
            Field {
                name: "user_code",
                value: &user_code,
            },
        ],
        None,
        "Stop, this wasn't me",
        false,
    ));
    Ok(sign_in_pages::render(
        StatusCode::OK,
        &title(&state),
        &body,
        None,
    ))
}

fn see_other(location: &str) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    if let Ok(value) = HeaderValue::from_str(location) {
        response.headers_mut().insert(header::LOCATION, value);
    }
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn device_pending(authorization: &Authorization, provider: &str, now: i64) -> PendingSignIn {
    PendingSignIn {
        id: random_token(),
        provider_id: provider.to_string(),
        client_state: String::new(),
        redirect_uri: String::new(),
        code_challenge: String::new(),
        device_public_key: authorization.device_public_key.clone(),
        device_name: authorization.device_name.clone(),
        platform: authorization.platform.clone(),
        setup_code_hash: authorization.setup_code_hash.clone(),
        provider_verifier: random_token(),
        provider_nonce: random_token(),
        expires_at: now + PENDING_TTL_MS,
        device_authorization: Some(authorization.id.clone()),
    }
}

async fn continue_with(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let authorization = match found_or_page(&state, ip, &headers, &form).await? {
        Ok(authorization) => authorization,
        Err(page) => return Ok(page),
    };
    let now = state.clock.now_ms();
    let mut pending = device_pending(&authorization, &form.provider, now);
    if let Some(provider) = state.providers.get(&form.provider) {
        let browser_secret = browser_binding::secret(&headers, &state.config);
        pending.code_challenge = browser_binding::challenge(&browser_secret);
        let callback = state
            .config
            .endpoint(&format!("/auth/callback/{}", pending.provider_id));
        let Ok(authorize) = provider
            .authorize_url(
                &pending.id,
                &callback,
                &pkce_s256(&pending.provider_verifier),
                &pending.provider_nonce,
            )
            .await
        else {
            return Ok(finished(
                &state,
                &pending,
                Err(AuthErrorCode::ProviderFailed),
            ));
        };
        state
            .db
            .call(move |conn| pending::insert(conn, &pending, now))
            .await?;
        let mut response = see_other(authorize.as_str());
        response.headers_mut().append(
            header::SET_COOKIE,
            browser_binding::cookie(&state.config, &browser_secret),
        );
        return Ok(response);
    }
    if form.provider == email_link::PROVIDER_ID && email_link_available(&state).await? {
        return email_sign_in::ask_for_address(&state, &headers, pending, now).await;
    }
    Ok(finished(
        &state,
        &pending,
        Err(AuthErrorCode::UnknownProvider),
    ))
}

async fn deny(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let authorization = match found_or_page(&state, ip.clone(), &headers, &form).await? {
        Ok(authorization) => authorization,
        Err(page) => return Ok(page),
    };
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            if device_code::deny(conn, &authorization.id, now)? {
                security_log::record(
                    conn,
                    now,
                    NewSecurityEvent {
                        actor: None,
                        kind: SecurityEventKind::SignInRefused,
                        target: Some(authorization.device_name.clone()),
                        ip,
                        detail: json!({
                            "flow": "device_code",
                            "reason": "stopped_by_person",
                            "platform": authorization.platform
                        }),
                    },
                )?;
            }
            Ok(())
        })
        .await?;
    Ok(sign_in_pages::message(
        StatusCode::OK,
        sign_in_pages::Tone::Notice,
        "Sign-in stopped",
        "Nobody can use this code now. If you meant to sign in, start again in Oleafly.",
    ))
}

pub(crate) fn finished(
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
) -> Response {
    finished_naming(state, pending, outcome, None)
}

fn provider_label(state: &AppState, provider_id: &str) -> String {
    state
        .providers
        .infos()
        .into_iter()
        .find(|info| info.id == provider_id)
        .map_or_else(|| "your sign-in provider".to_owned(), |info| info.label)
}

pub(crate) fn finished_naming(
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
    account: Option<&str>,
) -> Response {
    match outcome {
        Ok(Finish::DeviceApproved) => sign_in_pages::message(
            StatusCode::OK,
            sign_in_pages::Tone::Success,
            "You're signed in",
            &format!(
                "Go back to Oleafly on {}. It finishes signing in by itself. You can close this tab.",
                device_label(&pending.device_name, &pending.platform)
            ),
        ),
        Ok(Finish::DeviceGone | Finish::Code(_)) => sign_in_pages::message(
            StatusCode::BAD_REQUEST,
            sign_in_pages::Tone::Problem,
            "This code has expired",
            "Start signing in again in Oleafly to get a new code.",
        ),
        Err(AuthErrorCode::NotAdmitted) => {
            let by_email = pending.provider_id == email_link::PROVIDER_ID;
            let provider = provider_label(state, &pending.provider_id);
            let who = account
                .map(|account| {
                    if by_email {
                        format!("<p>You signed in with <strong>{}</strong>.</p>", escape(account))
                    } else {
                        format!(
                            "<p>You signed in to {} as <strong>{}</strong>.</p>",
                            escape(&provider),
                            escape(account)
                        )
                    }
                })
                .unwrap_or_default();
            let advice = if by_email {
                "To use a different address, start again in Oleafly with one the admin added."
                    .to_owned()
            } else {
                format!(
                    "To use a different account, sign out of {provider} in this browser, then start again in Oleafly."
                )
            };
            sign_in_pages::render(
                StatusCode::FORBIDDEN,
                "You can't sign in here yet",
                &format!(
                    "{}{}{who}{}{}",
                    status(Tone::Problem),
                    heading("You can't sign in here yet"),
                    paragraph(&ServerError::Auth(AuthErrorCode::NotAdmitted).public_message()),
                    next(&advice),
                ),
                None,
            )
        }
        Err(code @ AuthErrorCode::SetupCodeInvalid) => sign_in_pages::message(
            StatusCode::FORBIDDEN,
            sign_in_pages::Tone::Problem,
            "You can't sign in here yet",
            &ServerError::Auth(code).public_message(),
        ),
        Err(code) => sign_in_pages::message(
            StatusCode::BAD_REQUEST,
            sign_in_pages::Tone::Problem,
            "Sign-in didn't finish",
            &format!(
                "{} To try again, open {} and enter the code from Oleafly.",
                ServerError::Auth(code).public_message(),
                verification_uri(state)
            ),
        ),
    }
}
