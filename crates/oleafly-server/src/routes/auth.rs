use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::{MemberStatus, SecurityEventKind};
use oleafly_collab_protocol::auth::{
    AuthErrorCode, AuthStartQuery, ChallengePurpose, ChallengeResponse, RefreshRequest,
    SessionTokens, TokenRequest,
};
use oleafly_collab_protocol::crypto::{b64url_decode, pkce_s256};
use oleafly_collab_protocol::ids::ServerId;
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::json;
use url::Url;

use crate::auth::admission::{self, Applied, Via};
use crate::auth::pending::{self, PendingSignIn, PENDING_TTL_MS};
use crate::auth::refresh::{self, RefreshOutcome};
use crate::auth::{
    browser_binding, db_error, device_code, devices, email_link, nonce, setup, ExternalIdentity,
};
use crate::error::ServerError;
use crate::mail::notify;
use crate::members;
use crate::routes::{code_sign_in, email_sign_in, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::{setup_code_hash, AppState};
use crate::tokens::random_token;

const EXPIRED: &str = "This sign-in has expired. Start again in Oleafly.";
const INCOMPLETE: &str = "This sign-in request is incomplete. Start again in Oleafly.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/start", get(start))
        .route("/auth/callback/{provider}", get(callback))
        .route("/auth/challenge", post(challenge))
        .route("/auth/token", post(token))
        .route("/auth/refresh", post(refresh_session))
        .route("/auth/sign-out", post(sign_out))
}

pub fn loopback_redirect(raw: &str) -> Option<Url> {
    let url = Url::parse(raw).ok()?;
    let loopback = match url.host() {
        Some(url::Host::Ipv4(address)) => address == std::net::Ipv4Addr::LOCALHOST,
        Some(url::Host::Ipv6(address)) => address == std::net::Ipv6Addr::LOCALHOST,
        _ => false,
    };
    let valid = url.scheme() == "http"
        && loopback
        && url.port().is_some_and(|port| port != 0)
        && url.path() == "/callback"
        && url.query().is_none()
        && url.fragment().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    valid.then_some(url)
}

pub fn error_param(code: AuthErrorCode) -> &'static str {
    match code {
        AuthErrorCode::NotAdmitted => "not_admitted",
        AuthErrorCode::InvalidCode => "invalid_code",
        AuthErrorCode::InvalidSignature => "invalid_signature",
        AuthErrorCode::ExpiredNonce => "expired_nonce",
        AuthErrorCode::InvalidRedirect => "invalid_redirect",
        AuthErrorCode::UnknownProvider => "unknown_provider",
        AuthErrorCode::ProviderFailed => "provider_failed",
        AuthErrorCode::RefreshReused => "refresh_reused",
        AuthErrorCode::Revoked => "revoked",
        AuthErrorCode::SetupCodeInvalid => "setup_code_invalid",
        AuthErrorCode::SignInCancelled => "sign_in_cancelled",
    }
}

pub(crate) fn found(location: &str) -> Response {
    (
        StatusCode::FOUND,
        [
            (header::LOCATION, location.to_owned()),
            (header::CACHE_CONTROL, "no-store".to_owned()),
        ],
    )
        .into_response()
}

pub(crate) fn back_to_app(
    redirect: &Url,
    client_state: &str,
    outcome: Result<&str, AuthErrorCode>,
) -> Response {
    back_to_app_naming(redirect, client_state, outcome, None)
}

fn back_to_app_naming(
    redirect: &Url,
    client_state: &str,
    outcome: Result<&str, AuthErrorCode>,
    account: Option<&str>,
) -> Response {
    let mut target = redirect.clone();
    {
        let mut pairs = target.query_pairs_mut();
        match outcome {
            Ok(code) => pairs.append_pair("code", code),
            Err(error) => {
                if let (AuthErrorCode::NotAdmitted, Some(account)) = (&error, account) {
                    pairs.append_pair("account", account);
                }
                pairs.append_pair("error", error_param(error))
            }
        };
        pairs.append_pair("state", client_state);
    }
    found(target.as_str())
}

pub(crate) fn account_label(identity: &ExternalIdentity) -> String {
    identity
        .login
        .as_deref()
        .filter(|login| !login.is_empty())
        .map(|login| format!("@{login}"))
        .or_else(|| identity.verified_emails.first().cloned())
        .unwrap_or_else(|| identity.display_name.clone())
}

fn callback_url(state: &AppState, provider: &str) -> Url {
    state.config.endpoint(&format!("/auth/callback/{provider}"))
}

fn well_formed(query: &AuthStartQuery) -> bool {
    let challenge = b64url_decode(&query.code_challenge).is_ok_and(|bytes| bytes.len() == 32);
    let key = b64url_decode(&query.device_public_key).is_ok_and(|bytes| bytes.len() == 32);
    let client_state = !query.state.is_empty() && query.state.len() <= 512;
    let name = !query.device_name.trim().is_empty() && query.device_name.chars().count() <= 100;
    let platform = !query.platform.trim().is_empty() && query.platform.chars().count() <= 40;
    challenge && key && client_state && name && platform
}

pub(crate) async fn checked_setup_code(
    state: &AppState,
    code: Option<&str>,
) -> Result<Result<Option<String>, AuthErrorCode>, ServerError> {
    let Some(code) = code.filter(|code| !code.trim().is_empty()) else {
        return Ok(Ok(None));
    };
    let hash = setup_code_hash(code);
    let candidate = hash.clone();
    let matches = state
        .db
        .call(move |conn| setup::matches(conn, &candidate))
        .await?;
    Ok(if matches {
        Ok(Some(hash))
    } else {
        Err(AuthErrorCode::SetupCodeInvalid)
    })
}

pub(crate) async fn email_link_available(state: &AppState) -> Result<bool, ServerError> {
    if !state.mailer.is_configured() {
        return Ok(false);
    }
    let runtime = state.db.call(|conn| settings::load(conn)).await?;
    Ok(email_link::available(
        state.mailer.is_configured(),
        &runtime,
    ))
}

async fn start(
    State(state): State<AppState>,
    headers: HeaderMap,
    Query(query): Query<AuthStartQuery>,
) -> Result<Response, ServerError> {
    let redirect = loopback_redirect(&query.redirect_uri)
        .ok_or(ServerError::Auth(AuthErrorCode::InvalidRedirect))?;
    if !well_formed(&query) {
        return Err(ServerError::BadRequest(INCOMPLETE.to_owned()));
    }
    let provider = state.providers.get(&query.provider);
    let offered = match provider {
        Some(_) => true,
        None => query.provider == email_link::PROVIDER_ID && email_link_available(&state).await?,
    };
    if !offered {
        return Ok(back_to_app(
            &redirect,
            &query.state,
            Err(AuthErrorCode::UnknownProvider),
        ));
    }
    let setup_code_hash = match checked_setup_code(&state, query.setup_code.as_deref()).await? {
        Ok(hash) => hash,
        Err(code) => return Ok(back_to_app(&redirect, &query.state, Err(code))),
    };
    let now = state.clock.now_ms();
    let pending = PendingSignIn {
        id: random_token(),
        provider_id: query.provider.clone(),
        client_state: query.state.clone(),
        redirect_uri: redirect.to_string(),
        code_challenge: query.code_challenge.clone(),
        device_public_key: query.device_public_key.clone(),
        device_name: query.device_name.trim().to_owned(),
        platform: query.platform.trim().to_owned(),
        setup_code_hash,
        provider_verifier: random_token(),
        provider_nonce: random_token(),
        expires_at: now + PENDING_TTL_MS,
        device_authorization: None,
    };
    let Some(provider) = provider else {
        return email_sign_in::ask_for_address(&state, &headers, pending, now).await;
    };
    let callback = callback_url(&state, &pending.provider_id);
    let authorize = provider
        .authorize_url(
            &pending.id,
            &callback,
            &pkce_s256(&pending.provider_verifier),
            &pending.provider_nonce,
        )
        .await;
    let Ok(authorize) = authorize else {
        return Ok(back_to_app(
            &redirect,
            &query.state,
            Err(AuthErrorCode::ProviderFailed),
        ));
    };
    state
        .db
        .call(move |conn| pending::insert(conn, &pending, now))
        .await?;
    Ok(found(authorize.as_str()))
}

#[derive(Debug, Deserialize)]
struct CallbackQuery {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
}

async fn refuse_other_browser(
    state: &AppState,
    pending: &PendingSignIn,
    ip: Option<String>,
    now: i64,
) -> Result<Response, ServerError> {
    let event = NewSecurityEvent {
        actor: None,
        kind: SecurityEventKind::SignInRefused,
        target: Some(pending.device_name.clone()),
        ip,
        detail: json!({
            "provider": pending.provider_id,
            "flow": "device_code",
            "reason": "other_browser",
            "platform": pending.platform
        }),
    };
    state
        .db
        .call(move |conn| security_log::record(conn, now, event).map(|_| ()))
        .await?;
    conclude(state, pending, Err(AuthErrorCode::InvalidCode))
}

async fn callback(
    State(state): State<AppState>,
    Path(provider_id): Path<String>,
    ClientIp(ip): ClientIp,
    headers: HeaderMap,
    Query(query): Query<CallbackQuery>,
) -> Result<Response, ServerError> {
    let now = state.clock.now_ms();
    let Some(pending_id) = query.state else {
        return Err(ServerError::BadRequest(EXPIRED.to_owned()));
    };
    let pending = state
        .db
        .call(move |conn| pending::take(conn, &pending_id, now))
        .await?
        .filter(|pending| pending.provider_id == provider_id)
        .ok_or_else(|| ServerError::BadRequest(EXPIRED.to_owned()))?;
    if pending.device_authorization.is_some()
        && !browser_binding::holds(&headers, &state.config, &pending.code_challenge)
    {
        return refuse_other_browser(&state, &pending, ip, now).await;
    }
    let Some(provider) = state.providers.get(&provider_id) else {
        return conclude(&state, &pending, Err(AuthErrorCode::UnknownProvider));
    };
    let code = match (query.code, query.error.as_deref()) {
        (Some(code), None) => code,
        (_, Some("access_denied")) => {
            return conclude(&state, &pending, Err(AuthErrorCode::SignInCancelled))
        }
        _ => return conclude(&state, &pending, Err(AuthErrorCode::ProviderFailed)),
    };
    let callback = callback_url(&state, &provider_id);
    let exchanged = provider
        .exchange(
            &code,
            &callback,
            &pending.provider_verifier,
            &pending.provider_nonce,
        )
        .await;
    let Ok(identity) = exchanged else {
        return conclude(&state, &pending, Err(AuthErrorCode::ProviderFailed));
    };
    let account = account_label(&identity);
    let finishing = pending.clone();
    let max_members = state.config.limits.max_members_per_project;
    let outcome = state
        .db
        .call(move |conn| complete_sign_in(conn, &identity, &finishing, ip, max_members, now))
        .await?;
    conclude_naming(&state, &pending, outcome, Some(&account))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Finish {
    Code(String),
    DeviceApproved,
    DeviceGone,
}

pub(crate) fn conclude(
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
) -> Result<Response, ServerError> {
    conclude_naming(state, pending, outcome, None)
}

fn conclude_naming(
    state: &AppState,
    pending: &PendingSignIn,
    outcome: Result<Finish, AuthErrorCode>,
    account: Option<&str>,
) -> Result<Response, ServerError> {
    if pending.device_authorization.is_some() {
        return Ok(code_sign_in::finished_naming(
            state, pending, outcome, account,
        ));
    }
    let redirect = Url::parse(&pending.redirect_uri)
        .map_err(|error| ServerError::Internal(error.to_string()))?;
    let client_state = &pending.client_state;
    Ok(match outcome {
        Ok(Finish::Code(code)) => back_to_app(&redirect, client_state, Ok(&code)),
        Ok(Finish::DeviceApproved | Finish::DeviceGone) => {
            back_to_app(&redirect, client_state, Err(AuthErrorCode::InvalidCode))
        }
        Err(error) => back_to_app_naming(&redirect, client_state, Err(error), account),
    })
}

pub(crate) fn complete_sign_in(
    conn: &mut Connection,
    identity: &ExternalIdentity,
    pending: &PendingSignIn,
    ip: Option<String>,
    max_members: u32,
    now: i64,
) -> Result<Result<Finish, AuthErrorCode>, ServerError> {
    let tx = conn.transaction().map_err(db_error)?;
    if let Some(id) = &pending.device_authorization {
        if device_code::find_pending(&tx, id, now)?.is_none() {
            return Ok(Ok(Finish::DeviceGone));
        }
    }
    let decision = admission::decide(&tx, identity, pending.setup_code_hash.as_deref())?;
    let result = match admission::apply(&tx, identity, decision, max_members, now)? {
        Applied::Admitted(admitted) => {
            if admitted.via == Via::Setup {
                security_log::record(
                    &tx,
                    now,
                    NewSecurityEvent {
                        actor: Some(admitted.account_id),
                        kind: SecurityEventKind::SetupCompleted,
                        target: Some(admitted.account_id.to_string()),
                        ip: ip.clone(),
                        detail: json!({ "provider": identity.provider_id }),
                    },
                )?;
            }
            security_log::record(
                &tx,
                now,
                NewSecurityEvent {
                    actor: Some(admitted.account_id),
                    kind: SecurityEventKind::SignIn,
                    target: Some(admitted.account_id.to_string()),
                    ip,
                    detail: json!({
                        "provider": identity.provider_id,
                        "via": admitted.via.as_str(),
                        "new_account": admitted.new_account,
                        "reactivated": admitted.reactivated,
                        "device_code": pending.device_authorization.is_some()
                    }),
                },
            )?;
            match &pending.device_authorization {
                None => Ok(Finish::Code(pending::issue_code(
                    &tx,
                    pending,
                    admitted.account_id,
                    now,
                )?)),
                Some(id) => {
                    device_code::approve(&tx, id, admitted.account_id, now)?;
                    Ok(Finish::DeviceApproved)
                }
            }
        }
        Applied::Refused { code, reason } => {
            security_log::record(
                &tx,
                now,
                NewSecurityEvent {
                    actor: None,
                    kind: SecurityEventKind::SignInRefused,
                    target: Some(
                        identity
                            .login
                            .clone()
                            .unwrap_or_else(|| identity.subject.clone()),
                    ),
                    ip,
                    detail: json!({
                        "provider": identity.provider_id,
                        "issuer": identity.issuer,
                        "subject": identity.subject,
                        "reason": reason,
                        "device_code": pending.device_authorization.is_some()
                    }),
                },
            )?;
            if let Some(id) = &pending.device_authorization {
                device_code::refuse(&tx, id)?;
            }
            Err(code)
        }
    };
    tx.commit().map_err(db_error)?;
    Ok(result)
}

async fn challenge(State(state): State<AppState>) -> Result<Json<ChallengeResponse>, ServerError> {
    let now = state.clock.now_ms();
    Ok(Json(
        state.db.call(move |conn| nonce::issue(conn, now)).await?,
    ))
}

fn redeem_code(
    conn: &mut Connection,
    request: &TokenRequest,
    server_id: ServerId,
    ip: Option<String>,
    now: i64,
) -> Result<(SessionTokens, Option<(String, String)>), ServerError> {
    if !nonce::consume(conn, &request.nonce, now)? {
        return Err(ServerError::Auth(AuthErrorCode::ExpiredNonce));
    }
    let tx = conn.transaction().map_err(db_error)?;
    let code = pending::find_code(&tx, &request.code, now)?
        .ok_or(ServerError::Auth(AuthErrorCode::InvalidCode))?;
    if pkce_s256(&request.code_verifier) != code.code_challenge {
        return Err(ServerError::Auth(AuthErrorCode::InvalidCode));
    }
    let signed = request.device_public_key == code.device_public_key
        && devices::signature_valid(
            &request.device_public_key,
            ChallengePurpose::Token,
            server_id,
            &request.nonce,
            &request.signature,
        );
    if !signed {
        return Err(ServerError::Auth(AuthErrorCode::InvalidSignature));
    }
    if !matches!(
        members::account_status(&tx, code.account_id)?,
        Some(MemberStatus::Active)
    ) {
        return Err(ServerError::Auth(AuthErrorCode::NotAdmitted));
    }
    if !pending::mark_code_used(&tx, &request.code, now)? {
        return Err(ServerError::Auth(AuthErrorCode::InvalidCode));
    }
    let registered = devices::register(
        &tx,
        code.account_id,
        &code.device_public_key,
        &code.device_name,
        &code.platform,
        now,
    )?;
    if registered.added {
        security_log::record(
            &tx,
            now,
            NewSecurityEvent {
                actor: Some(code.account_id),
                kind: SecurityEventKind::DeviceAdded,
                target: Some(registered.device_id.to_string()),
                ip,
                detail: json!({ "name": code.device_name, "platform": code.platform }),
            },
        )?;
    }
    let tokens = refresh::issue_session(&tx, code.account_id, registered.device_id, now)?;
    tx.commit().map_err(db_error)?;
    let added = registered
        .added
        .then(|| (code.device_name.clone(), code.platform.clone()));
    Ok((tokens, added))
}

async fn token(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(request): Json<TokenRequest>,
) -> Result<Json<SessionTokens>, ServerError> {
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    let (tokens, added) = state
        .db
        .call(move |conn| redeem_code(conn, &request, server_id, ip, now))
        .await?;
    if let Some((name, platform)) = added {
        notify::new_sign_in(
            &state,
            tokens.account_id,
            tokens.device_id,
            name,
            platform,
            now,
        );
    }
    Ok(Json(tokens))
}

enum RefreshResult {
    Tokens(SessionTokens),
    Reused,
    Invalid,
}

fn rotate_session(
    conn: &mut Connection,
    request: &RefreshRequest,
    server_id: ServerId,
    ip: Option<String>,
    now: i64,
) -> Result<RefreshResult, ServerError> {
    if !nonce::consume(conn, &request.nonce, now)? {
        return Err(ServerError::Auth(AuthErrorCode::ExpiredNonce));
    }
    let tx = conn.transaction().map_err(db_error)?;
    let Some(device) = devices::find(&tx, request.device_id)?.filter(|device| !device.revoked)
    else {
        return Ok(RefreshResult::Invalid);
    };
    let signed = devices::signature_valid(
        &device.public_key,
        ChallengePurpose::Refresh,
        server_id,
        &request.nonce,
        &request.signature,
    );
    if !signed {
        return Err(ServerError::Auth(AuthErrorCode::InvalidSignature));
    }
    if !matches!(
        members::account_status(&tx, device.account_id)?,
        Some(MemberStatus::Active)
    ) {
        return Ok(RefreshResult::Invalid);
    }
    let result = match refresh::rotate(&tx, &request.refresh_token, request.device_id, now)? {
        RefreshOutcome::Rotated(tokens) | RefreshOutcome::Replayed(tokens) => {
            devices::touch(&tx, request.device_id, now)?;
            RefreshResult::Tokens(tokens)
        }
        RefreshOutcome::Reused { family_id } => {
            refresh::revoke_family(&tx, &family_id, now)?;
            security_log::record(
                &tx,
                now,
                NewSecurityEvent {
                    actor: Some(device.account_id),
                    kind: SecurityEventKind::RefreshReuseDetected,
                    target: Some(request.device_id.to_string()),
                    ip,
                    detail: json!({ "family": family_id }),
                },
            )?;
            RefreshResult::Reused
        }
        RefreshOutcome::Invalid => RefreshResult::Invalid,
    };
    tx.commit().map_err(db_error)?;
    Ok(result)
}

async fn refresh_session(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    Json(request): Json<RefreshRequest>,
) -> Result<Json<SessionTokens>, ServerError> {
    let now = state.clock.now_ms();
    let server_id = state.server_id;
    let device_id = request.device_id;
    let result = state
        .db
        .call(move |conn| rotate_session(conn, &request, server_id, ip, now))
        .await?;
    match result {
        RefreshResult::Tokens(tokens) => Ok(Json(tokens)),
        RefreshResult::Reused => {
            state.revoke_device(device_id).await?;
            Err(ServerError::Auth(AuthErrorCode::RefreshReused))
        }
        RefreshResult::Invalid => Err(ServerError::Auth(AuthErrorCode::Revoked)),
    }
}

async fn sign_out(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    auth: Authenticated,
) -> Result<StatusCode, ServerError> {
    let now = state.clock.now_ms();
    let account = auth.account_id;
    let device = auth.device_id;
    state
        .db
        .call(move |conn| {
            security_log::record(
                conn,
                now,
                NewSecurityEvent {
                    actor: Some(account),
                    kind: SecurityEventKind::DeviceSignedOut,
                    target: Some(device.to_string()),
                    ip,
                    detail: json!({ "by": "self" }),
                },
            )?;
            Ok(())
        })
        .await?;
    state.revoke_device(device).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_callbacks_are_accepted() {
        assert!(loopback_redirect("http://127.0.0.1:53111/callback").is_some());
        assert!(loopback_redirect("http://[::1]:53111/callback").is_some());
    }

    #[test]
    fn every_other_redirect_is_refused() {
        for raw in [
            "https://127.0.0.1:53111/callback",
            "http://localhost:53111/callback",
            "http://127.0.0.2:53111/callback",
            "http://127.0.0.1/callback",
            "http://127.0.0.1:53111/callback/",
            "http://127.0.0.1:53111/other",
            "http://127.0.0.1:53111/callback?next=x",
            "http://127.0.0.1:53111/callback#x",
            "http://user@127.0.0.1:53111/callback",
            "http://127.0.0.1.evil.example:53111/callback",
            "not a url",
        ] {
            assert!(loopback_redirect(raw).is_none(), "{raw} was accepted");
        }
    }

    #[test]
    fn error_params_are_snake_case() {
        assert_eq!(error_param(AuthErrorCode::NotAdmitted), "not_admitted");
        assert_eq!(
            error_param(AuthErrorCode::SetupCodeInvalid),
            "setup_code_invalid"
        );
        assert_eq!(
            error_param(AuthErrorCode::SignInCancelled),
            "sign_in_cancelled"
        );
    }
}
