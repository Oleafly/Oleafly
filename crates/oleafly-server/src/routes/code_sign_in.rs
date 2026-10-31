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
use crate::auth::{
    browser_binding, clean_label, csrf, db_error, devices, nonce, noting_failure, refresh,
};
use crate::error::ServerError;
use crate::i18n::{Key, Locale, PageLocale};
use crate::mail::messages::escape;
use crate::mail::notify;
use crate::members;
use crate::rate_limit::client_key;
use crate::routes::auth::{
    checked_setup_code, email_link_available, note_provider_problem, Finish,
};
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

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/device/code", post(issue))
        .route("/auth/device/token", post(token))
        .route("/auth/device", get(entry).post(check))
        .route("/auth/device/continue", post(continue_with))
        .route("/auth/device/deny", post(deny))
}

fn title(locale: Locale, state: &AppState) -> String {
    locale.fill(Key::SignInTitle, &[("server", &state.config.server_name)])
}

fn path(state: &AppState, route: &str) -> String {
    state.config.endpoint(route).path().to_string()
}

fn verification_uri(state: &AppState) -> String {
    state.config.endpoint("/auth/device").to_string()
}

const PLATFORMS: [&str; 3] = ["macos", "windows", "linux"];

fn well_formed(request: &DeviceCodeRequest) -> bool {
    let key = b64url_decode(&request.device_public_key).is_ok_and(|bytes| bytes.len() == 32);
    let name =
        !clean_label(&request.device_name).is_empty() && request.device_name.chars().count() <= 100;
    let platform = PLATFORMS.contains(&request.platform.trim().to_ascii_lowercase().as_str());
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
        device_name: clean_label(&request.device_name),
        platform: request.platform.trim().to_ascii_lowercase(),
        setup_code_hash,
        requested_from: ip.as_deref().map(client_key),
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
        Status::Used => {
            match device_code::replay(&tx, &authorization.id, &request.device_code, now)? {
                Some(tokens) => (DevicePoll::Approved { tokens }, None),
                None => return Err(ServerError::Auth(AuthErrorCode::InvalidCode)),
            }
        }
        Status::Refused => return Err(ServerError::Auth(AuthErrorCode::NotAdmitted)),
        Status::Denied => (DevicePoll::Denied, None),
        _ if authorization.expires_at <= now => (DevicePoll::Expired, None),
        Status::Pending => match device_code::record_poll(&tx, &authorization.id, now)? {
            Pace::Steady { interval } => (DevicePoll::Pending { interval }, None),
            Pace::TooFast { interval } => (DevicePoll::SlowDown { interval }, None),
        },
        Status::Approved => approved(&tx, &authorization, &request.device_code, ip, now)?,
    };
    tx.commit().map_err(db_error)?;
    Ok(outcome)
}

fn approved(
    tx: &Connection,
    authorization: &Authorization,
    device_code: &str,
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
    device_code::keep_reply(tx, &authorization.id, device_code, &tokens, now)?;
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

fn entry_body(
    locale: Locale,
    state: &AppState,
    csrf: &str,
    code: &str,
    problem: Option<Key>,
) -> String {
    let mut body = sign_in_pages::heading(&title(locale, state));
    body.push_str(&sign_in_pages::paragraph(locale.text(Key::CodeEnter)));
    if let Some(problem) = problem {
        body.push_str(&sign_in_pages::error(locale.text(problem)));
    }
    body.push_str(&sign_in_pages::form(
        &path(state, "/auth/device"),
        &[Field {
            name: "csrf",
            value: csrf,
        }],
        Some(Input {
            label: locale.text(Key::CodeLabel),
            name: "user_code",
            kind: "text",
            value: code,
            autocomplete: "off",
        }),
        locale.text(Key::Continue),
        true,
    ));
    body
}

#[derive(Deserialize)]
struct EntryQuery {
    code: Option<String>,
    provider: Option<String>,
}

async fn entry(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Query(query): Query<EntryQuery>,
) -> Result<Response, ServerError> {
    let csrf = csrf::token(&headers);
    let cookie = Some(csrf::cookie(&state.config, &csrf));
    let Some(code) = query
        .code
        .as_deref()
        .and_then(device_code::normalize_user_code)
    else {
        return Ok(sign_in_pages::render(
            locale,
            StatusCode::OK,
            &title(locale, &state),
            &entry_body(locale, &state, &csrf, "", None),
            cookie,
        ));
    };
    let here = ip.as_deref().map(client_key);
    Ok(match lookup(&state, ip, &code).await? {
        Lookup::Found(authorization) => {
            let page = Confirm {
                csrf: &csrf,
                authorization: &authorization,
                user_code: &code,
                here: here.as_deref(),
                chosen: query.provider.as_deref(),
            };
            confirm_page(locale, &state, &page, cookie).await?
        }
        Lookup::LockedOut => locked_out(locale),
        Lookup::Wrong => sign_in_pages::render(
            locale,
            StatusCode::BAD_REQUEST,
            &title(locale, &state),
            &entry_body(locale, &state, &csrf, &code, Some(Key::CodeWrong)),
            cookie,
        ),
    })
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

pub(crate) fn locked_out(locale: Locale) -> Response {
    sign_in_pages::notice(
        locale,
        StatusCode::TOO_MANY_REQUESTS,
        sign_in_pages::Tone::Notice,
        Key::CodeLockedTitle,
        Key::CodeLockedBody,
    )
}

async fn found_or_page(
    locale: Locale,
    state: &AppState,
    ip: Option<String>,
    headers: &HeaderMap,
    form: &CodeForm,
) -> Result<Result<Authorization, Response>, ServerError> {
    if !csrf::verify(headers, &state.config, &form.csrf) {
        return Ok(Err(page_expired(locale)));
    }
    Ok(match lookup(state, ip, &form.user_code).await? {
        Lookup::Found(authorization) => Ok(authorization),
        Lookup::LockedOut => Err(locked_out(locale)),
        Lookup::Wrong => {
            let typed = form.user_code.trim().chars().take(32).collect::<String>();
            Err(sign_in_pages::render(
                locale,
                StatusCode::BAD_REQUEST,
                &title(locale, state),
                &entry_body(locale, state, &form.csrf, &typed, Some(Key::CodeWrong)),
                None,
            ))
        }
    })
}

async fn check(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let here = ip.as_deref().map(client_key);
    let authorization = match found_or_page(locale, &state, ip, &headers, &form).await? {
        Ok(authorization) => authorization,
        Err(page) => return Ok(page),
    };
    let user_code = device_code::normalize_user_code(&form.user_code).unwrap_or_default();
    let page = Confirm {
        csrf: &form.csrf,
        authorization: &authorization,
        user_code: &user_code,
        here: here.as_deref(),
        chosen: None,
    };
    confirm_page(locale, &state, &page, None).await
}

struct Confirm<'a> {
    csrf: &'a str,
    authorization: &'a Authorization,
    user_code: &'a str,
    here: Option<&'a str>,
    chosen: Option<&'a str>,
}

async fn confirm_page(
    locale: Locale,
    state: &AppState,
    page: &Confirm<'_>,
    cookie: Option<HeaderValue>,
) -> Result<Response, ServerError> {
    let authorization = page.authorization;
    let device = device_label(&authorization.device_name, &authorization.platform);
    let mut body = sign_in_pages::heading(&title(locale, state));
    body.push_str(&sign_in_pages::paragraph(
        &locale.fill(Key::CodeAsked, &[("device", &device)]),
    ));
    body.push_str(&sign_in_pages::code(page.user_code));
    if from_another_network(authorization.requested_from.as_deref(), page.here) {
        body.push_str(&sign_in_pages::error(locale.text(Key::CodeOtherNetwork)));
    }
    body.push_str(&sign_in_pages::paragraph(locale.text(Key::CodeOnlyIfYou)));
    let runtime_email = email_link_available(state).await?;
    let providers = email_link::with_email_link(state.providers.infos(), runtime_email);
    if providers.is_empty() {
        body.push_str(&sign_in_pages::paragraph(locale.text(Key::CodeNoProviders)));
    }
    let chosen: Vec<_> = providers
        .iter()
        .filter(|provider| page.chosen == Some(provider.id.as_str()))
        .collect();
    let offered: Vec<_> = if chosen.is_empty() {
        providers.iter().collect()
    } else {
        chosen
    };
    for provider in offered {
        body.push_str(&sign_in_pages::form(
            &path(state, "/auth/device/continue"),
            &[
                Field {
                    name: "csrf",
                    value: page.csrf,
                },
                Field {
                    name: "user_code",
                    value: page.user_code,
                },
                Field {
                    name: "provider",
                    value: &provider.id,
                },
            ],
            None,
            &provider_button(locale, provider),
            true,
        ));
    }
    body.push_str(&sign_in_pages::quiet_form(
        &path(state, "/auth/device/deny"),
        &[
            Field {
                name: "csrf",
                value: page.csrf,
            },
            Field {
                name: "user_code",
                value: page.user_code,
            },
        ],
        locale.text(Key::CodeDeny),
    ));
    Ok(sign_in_pages::render(
        locale,
        StatusCode::OK,
        &title(locale, state),
        &body,
        cookie,
    ))
}

fn from_another_network(requested_from: Option<&str>, here: Option<&str>) -> bool {
    matches!((requested_from, here), (Some(from), Some(here)) if from != here)
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
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let authorization = match found_or_page(locale, &state, ip, &headers, &form).await? {
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
        let (authorize, detail) = noting_failure(provider.authorize_url(
            &pending.id,
            &callback,
            &pkce_s256(&pending.provider_verifier),
            &pending.provider_nonce,
        ))
        .await;
        let Ok(authorize) = authorize else {
            note_provider_problem(&state, &pending.provider_id, detail, now);
            return Ok(finished(
                locale,
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
        return email_sign_in::ask_for_address(locale, &state, &headers, pending, now).await;
    }
    Ok(finished(
        locale,
        &state,
        &pending,
        Err(AuthErrorCode::UnknownProvider),
    ))
}

async fn deny(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    PageLocale(locale): PageLocale,
    headers: HeaderMap,
    Form(form): Form<CodeForm>,
) -> Result<Response, ServerError> {
    let authorization = match found_or_page(locale, &state, ip.clone(), &headers, &form).await? {
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
    Ok(sign_in_pages::notice(
        locale,
        StatusCode::OK,
        sign_in_pages::Tone::Notice,
        Key::CodeStoppedTitle,
        Key::CodeStoppedBody,
    ))
}

pub(crate) fn finished(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
) -> Response {
    finished_naming(locale, state, pending, outcome, None)
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

fn refused(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    account: Option<&str>,
) -> Response {
    let by_email = pending.provider_id == email_link::PROVIDER_ID;
    let provider = provider_label(locale, state, &pending.provider_id);
    let server = escape(&state.config.server_name);
    let who = account.map(|account| {
        let account = format!("<strong>{}</strong>", escape(account));
        let named = if by_email {
            locale.fill_html(
                Key::RefusedEmailAccount,
                &[("account", &account), ("server", &server)],
            )
        } else {
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
    });
    let advice = if by_email {
        locale.text(Key::RefusedEmailAdvice).to_owned()
    } else {
        locale.fill(Key::RefusedProviderAdvice, &[("provider", &provider)])
    };
    let title = locale.text(Key::RefusedTitle);
    sign_in_pages::render(
        locale,
        StatusCode::FORBIDDEN,
        title,
        &format!(
            "{}{}{}{}",
            status(Tone::Problem),
            heading(title),
            who.unwrap_or_else(|| paragraph(locale.auth_error(AuthErrorCode::NotAdmitted))),
            next(&advice),
        ),
        None,
    )
}

pub(crate) fn finished_naming(
    locale: Locale,
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
    account: Option<&str>,
) -> Response {
    match outcome {
        Ok(Finish::DeviceApproved) => sign_in_pages::message(
            locale,
            StatusCode::OK,
            sign_in_pages::Tone::Success,
            locale.text(Key::CodeDoneTitle),
            &locale.fill(
                Key::CodeDoneBody,
                &[(
                    "device",
                    &device_label(&pending.device_name, &pending.platform),
                )],
            ),
        ),
        Ok(Finish::DeviceGone | Finish::Code(_) | Finish::Web(_)) => sign_in_pages::notice(
            locale,
            StatusCode::BAD_REQUEST,
            sign_in_pages::Tone::Problem,
            Key::CodeExpiredTitle,
            Key::CodeExpiredBody,
        ),
        Err(AuthErrorCode::NotAdmitted) => refused(locale, state, pending, account),
        Err(code @ AuthErrorCode::SetupCodeInvalid) => sign_in_pages::message(
            locale,
            StatusCode::FORBIDDEN,
            sign_in_pages::Tone::Problem,
            locale.text(Key::RefusedTitle),
            locale.auth_error(code),
        ),
        Err(code) => sign_in_pages::message(
            locale,
            StatusCode::BAD_REQUEST,
            sign_in_pages::Tone::Problem,
            locale.text(Key::NotFinishedTitle),
            &locale.fill(
                Key::CodeRetry,
                &[
                    ("reason", locale.auth_error(code)),
                    ("link", &verification_uri(state)),
                ],
            ),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::test_app;

    fn pending(provider: &str) -> PendingSignIn {
        PendingSignIn {
            id: "pending".to_owned(),
            provider_id: provider.to_owned(),
            client_state: String::new(),
            redirect_uri: String::new(),
            code_challenge: String::new(),
            device_public_key: String::new(),
            device_name: "Lab PC".to_owned(),
            platform: "linux".to_owned(),
            setup_code_hash: None,
            provider_verifier: String::new(),
            provider_nonce: String::new(),
            expires_at: 0,
            device_authorization: Some("authorization".to_owned()),
        }
    }

    async fn text_of(response: Response) -> String {
        let body = axum::body::to_bytes(response.into_body(), 64 * 1024)
            .await
            .unwrap();
        String::from_utf8_lossy(&body).into_owned()
    }

    #[test]
    fn only_two_different_known_networks_count_as_another_network() {
        assert!(from_another_network(
            Some("198.51.100.1"),
            Some("203.0.113.1")
        ));
        assert!(!from_another_network(
            Some("198.51.100.1"),
            Some("198.51.100.1")
        ));
        assert!(!from_another_network(None, Some("203.0.113.1")));
        assert!(!from_another_network(Some("198.51.100.1"), None));
    }

    #[tokio::test]
    async fn a_used_setup_code_is_explained_in_the_page_language() {
        let app = test_app().await;
        let romanian = Locale::named("ro").expect("romanian");
        let response = finished(
            romanian,
            &app.state,
            &pending("github"),
            Err(AuthErrorCode::SetupCodeInvalid),
        );
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        let page = text_of(response).await;
        assert!(
            page.starts_with("<!doctype html><html lang=\"ro\">"),
            "{page}"
        );
        assert!(
            page.contains(&escape(romanian.text(Key::RefusedTitle))),
            "{page}"
        );
        assert!(
            page.contains(&escape(
                romanian.auth_error(AuthErrorCode::SetupCodeInvalid)
            )),
            "{page}"
        );
        assert!(!page.contains("setup code"), "{page}");
    }

    #[tokio::test]
    async fn a_provider_that_is_gone_is_named_in_the_page_language() {
        let app = test_app().await;
        let turkish = Locale::named("tr").expect("turkish");
        let response = finished_naming(
            turkish,
            &app.state,
            &pending("gitlab"),
            Err(AuthErrorCode::NotAdmitted),
            Some("@ada"),
        );
        let page = text_of(response).await;
        let provider = turkish.text(Key::SomeProvider);
        assert!(
            page.contains(&turkish.fill_html(
                Key::RefusedProviderAccount,
                &[
                    ("provider", &escape(provider)),
                    ("account", "<strong>@ada</strong>"),
                    ("server", &escape(&app.state.config.server_name))
                ]
            )),
            "{page}"
        );
        assert!(
            page.contains(&escape(
                &turkish.fill(Key::RefusedProviderAdvice, &[("provider", provider)])
            )),
            "{page}"
        );
        assert!(!page.contains("your sign-in provider"), "{page}");
    }
}
