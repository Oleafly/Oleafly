use axum::extract::rejection::JsonRejection;
use axum::extract::State;
use axum::routing::{get, post};
use axum::{Json, Router};
use oleafly_collab_protocol::email::{
    EmailPreferences, EmailPreferencesPatch, EmailStatus, EmailTestResult,
};
use oleafly_collab_protocol::ids::AccountId;
use oleafly_collab_protocol::roles::ServerAction;
use rusqlite::Connection;

use crate::error::ServerError;
use crate::mail::{deliverable, messages, preferences, EmailKind, OutgoingEmail};
use crate::members;
use crate::routes::{json_body, Authenticated};
use crate::settings;
use crate::state::AppState;

const NOT_CONFIGURED: &str = "This server has no email settings. Set OLEAFLY_SMTP_URL and OLEAFLY_MAIL_FROM, then restart it.";
const NO_ADDRESS: &str = "Your account has no verified email address to send the test to. Sign in with a provider that shares your email address.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/email", get(status))
        .route("/api/v1/admin/email/test", post(send_test))
        .route(
            "/api/v1/me/email-preferences",
            get(read_preferences).patch(change_preferences),
        )
}

async fn status(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<EmailStatus>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let notifications = state
        .db
        .call(|conn| Ok(settings::load(conn)?.email_notifications))
        .await?;
    Ok(Json(EmailStatus {
        configured: state.mailer.is_configured(),
        from: state.mailer.from_address(),
        notifications,
        last_failure: state.mailer.stats().last_failure,
    }))
}

async fn send_test(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<EmailTestResult>, ServerError> {
    auth.require(ServerAction::ChangeSettings)?;
    if !state.mailer.is_configured() {
        return Err(ServerError::Conflict(NOT_CONFIGURED.to_string()));
    }
    let account = auth.account_id;
    let emails = state
        .db
        .call(move |conn| {
            Ok(members::account_summary(conn, account)?
                .map(|summary| summary.emails)
                .unwrap_or_default())
        })
        .await?;
    let to = deliverable(&emails);
    if to.is_empty() {
        return Err(ServerError::BadRequest(NO_ADDRESS.to_string()));
    }
    let mut sending = tokio::task::JoinSet::new();
    for (index, address) in to.iter().cloned().enumerate() {
        let mailer = state.mailer.clone();
        let content = messages::test_message(&state.config.server_name);
        sending.spawn(async move {
            let email = OutgoingEmail::new(EmailKind::Test, vec![address.clone()], content);
            (index, address, mailer.send_now(email).await)
        });
    }
    let mut outcomes = sending.join_all().await;
    outcomes.sort_by_key(|(index, _, _)| *index);
    let several = outcomes.len() > 1;
    let mut sent_to = Vec::new();
    let mut failures = Vec::new();
    for (_, address, outcome) in outcomes {
        match outcome {
            Ok(()) => sent_to.push(address),
            Err(error) => {
                tracing::warn!("The test email failed: {error}");
                failures.push(if several {
                    format!("{address}: {error}")
                } else {
                    error
                });
            }
        }
    }
    Ok(Json(EmailTestResult {
        sent_to,
        delivered: failures.is_empty(),
        error: (!failures.is_empty()).then(|| failures.join("\n")),
    }))
}

fn preferences_of(
    conn: &Connection,
    state: &AppState,
    account: AccountId,
) -> Result<EmailPreferences, ServerError> {
    Ok(EmailPreferences {
        shared_with_you: preferences::shared_with_you(conn, account)?,
        mentions: Some(preferences::mentions(conn, account)?),
        mail_configured: state.mailer.is_configured(),
        notifications: settings::load(conn)?.email_notifications,
    })
}

async fn read_preferences(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<EmailPreferences>, ServerError> {
    let account = auth.account_id;
    let reader = state.clone();
    let current = state
        .db
        .call(move |conn| preferences_of(conn, &reader, account))
        .await?;
    Ok(Json(current))
}

async fn change_preferences(
    State(state): State<AppState>,
    auth: Authenticated,
    body: Result<Json<EmailPreferencesPatch>, JsonRejection>,
) -> Result<Json<EmailPreferences>, ServerError> {
    let change = json_body(body)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let writer = state.clone();
    let updated = state
        .db
        .call(move |conn| {
            if let Some(enabled) = change.shared_with_you {
                preferences::set_shared_with_you(conn, account, enabled, now)?;
            }
            if let Some(enabled) = change.mentions {
                preferences::set_mentions(conn, account, enabled, now)?;
            }
            preferences_of(conn, &writer, account)
        })
        .await?;
    Ok(Json(updated))
}
