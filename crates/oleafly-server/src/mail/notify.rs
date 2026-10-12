use std::future::Future;

use oleafly_collab_protocol::admin::MemberStatus;
use oleafly_collab_protocol::ids::{AccountId, DeviceId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectStatus;
use oleafly_collab_protocol::roles::{ProjectRole, ServerRole};
use rusqlite::{params, Connection};

use crate::error::ServerError;
use crate::mail::{deliverable, messages, preferences, EmailKind, OutgoingEmail};
use crate::members;
use crate::projects;
use crate::settings;
use crate::state::AppState;

fn spawn<F, Prepared>(state: &AppState, kind: EmailKind, prepare: F)
where
    F: FnOnce(AppState) -> Prepared + Send + 'static,
    Prepared: Future<Output = Result<Option<OutgoingEmail>, ServerError>> + Send + 'static,
{
    let Some(tracked) = state.mailer.track() else {
        return;
    };
    let state = state.clone();
    tokio::spawn(async move {
        let _tracked = tracked;
        match prepare(state.clone()).await {
            Ok(Some(email)) => state.mailer.enqueue(email),
            Ok(None) => {}
            Err(error) => tracing::warn!("Could not prepare the {} email: {error}", kind.label()),
        }
    });
}

fn verified_emails(conn: &Connection, account: AccountId) -> Result<Vec<String>, ServerError> {
    Ok(members::account_summary(conn, account)?
        .map(|summary| deliverable(&summary.emails))
        .unwrap_or_default())
}

fn is_active(conn: &Connection, account: AccountId) -> Result<bool, ServerError> {
    Ok(matches!(
        members::account_status(conn, account)?,
        Some(MemberStatus::Active)
    ))
}

pub fn added_to_server(state: &AppState, address: String, role: ServerRole) {
    spawn(state, EmailKind::AddedToServer, move |state| async move {
        let on = state
            .db
            .call(|conn| Ok(settings::load(conn)?.email_notifications))
            .await?;
        let to = deliverable(std::slice::from_ref(&address));
        if !on || to.is_empty() {
            return Ok(None);
        }
        let content = messages::added_to_server(
            &state.config.server_name,
            &state.config.public_url,
            role,
            &to[0],
        );
        Ok(Some(OutgoingEmail::new(
            EmailKind::AddedToServer,
            to,
            content,
        )))
    });
}

pub fn shared_with_you(
    state: &AppState,
    project: SharedProjectId,
    person: AccountId,
    sharer: AccountId,
    role: ProjectRole,
) {
    spawn(state, EmailKind::SharedWithYou, move |state| async move {
        let found = state
            .db
            .call(move |conn| {
                if !settings::load(conn)?.email_notifications
                    || !preferences::shared_with_you(conn, person)?
                    || !is_active(conn, person)?
                    || projects::role_of(conn, project, person)? != Some(role)
                {
                    return Ok(None);
                }
                let Some(row) = projects::project_row(conn, project)? else {
                    return Ok(None);
                };
                if row.status != ProjectStatus::Active {
                    return Ok(None);
                }
                let sharer_name = members::account_summary(conn, sharer)?
                    .map(|summary| summary.display_name)
                    .unwrap_or_else(|| "Someone".to_string());
                Ok(Some((
                    verified_emails(conn, person)?,
                    row.title,
                    sharer_name,
                )))
            })
            .await?;
        let Some((to, title, sharer_name)) = found.filter(|(to, _, _)| !to.is_empty()) else {
            return Ok(None);
        };
        let content = messages::shared_with_you(
            &state.config.server_name,
            &state.config.public_url,
            project,
            &title,
            &sharer_name,
            role,
        );
        Ok(Some(OutgoingEmail::new(
            EmailKind::SharedWithYou,
            to,
            content,
        )))
    });
}

pub fn new_sign_in(
    state: &AppState,
    account: AccountId,
    device: DeviceId,
    name: String,
    platform: String,
    at_ms: i64,
) {
    spawn(state, EmailKind::NewSignIn, move |state| async move {
        let to = state
            .db
            .call(move |conn| {
                if !settings::load(conn)?.email_notifications {
                    return Ok(Vec::new());
                }
                let others: i64 = conn.query_row(
                    "SELECT COUNT(*) FROM devices WHERE account_id = ?1 AND id != ?2",
                    params![account.to_string(), device.to_string()],
                    |row| row.get(0),
                )?;
                if others == 0 {
                    return Ok(Vec::new());
                }
                verified_emails(conn, account)
            })
            .await?;
        if to.is_empty() {
            return Ok(None);
        }
        let content = messages::new_sign_in(
            &state.config.server_name,
            &name,
            &platform,
            &messages::local_time(at_ms),
        );
        Ok(Some(OutgoingEmail::new(EmailKind::NewSignIn, to, content)))
    });
}
