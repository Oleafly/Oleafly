use std::future::Future;
use std::net::SocketAddr;

use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::auth::SessionTokens;
use oleafly_collab_protocol::frames::ServerFrame;
use oleafly_collab_protocol::ids::{AccountId, SharedProjectId};
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_collab_protocol::roles::ServerRole;
use rusqlite::{params, OptionalExtension};
use serde_json::json;

use crate::auth::{devices, refresh};
use crate::build_router;
use crate::db::parse_id;
use crate::error::ServerError;
use crate::members;
use crate::projects;
use crate::security_log::{self, NewSecurityEvent};
use crate::state::AppState;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersonSeed {
    pub name: String,
    pub email: String,
    pub role: ServerRole,
    pub device_public_key: String,
    pub device_name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ProjectLog {
    pub head_seq: u64,
    pub oldest_kept: Option<u64>,
    pub kept_updates: u64,
    pub kept_bytes: u64,
    pub snapshots: Vec<(u64, String)>,
}

pub async fn seed_person(state: &AppState, seed: PersonSeed) -> Result<SessionTokens, ServerError> {
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let email = members::normalize_email(&seed.email)
                .ok_or_else(|| ServerError::BadRequest(format!("{} is not an email", seed.email)))?;
            let transaction = conn.transaction()?;
            let existing: Option<String> = transaction
                .query_row(
                    "SELECT account_id FROM account_emails WHERE email = ?1",
                    [&email],
                    |row| row.get(0),
                )
                .optional()?;
            let account = match existing {
                Some(id) => parse_id::<AccountId>(&id)?,
                None => {
                    let account =
                        members::create_account(&transaction, &seed.name, None, seed.role, now)?;
                    members::add_verified_emails(&transaction, account, &[email])?;
                    security_log::record(
                        &transaction,
                        now,
                        NewSecurityEvent {
                            actor: None,
                            kind: SecurityEventKind::MemberAdded,
                            target: Some(account.to_string()),
                            ip: None,
                            detail: json!({ "role": members::role_to_str(seed.role), "seeded": true }),
                        },
                    )?;
                    account
                }
            };
            let device = devices::register(
                &transaction,
                account,
                &seed.device_public_key,
                &seed.device_name,
                "crowd",
                now,
            )?;
            let tokens = refresh::issue_session(&transaction, account, device.device_id, now)?;
            transaction.commit()?;
            Ok(tokens)
        })
        .await
}

pub async fn grant_project_role(
    state: &AppState,
    project: SharedProjectId,
    account: AccountId,
    role: ProjectRole,
) -> Result<bool, ServerError> {
    let now = state.clock.now_ms();
    let changed = state
        .db
        .call(move |conn| {
            let row = projects::project_row(conn, project)?.ok_or(ServerError::NotFound)?;
            let existing = projects::role_of(conn, project, account)?;
            if existing == Some(role) || existing == Some(ProjectRole::Owner) {
                return Ok(false);
            }
            if !projects::account_can_join(conn, account)? {
                return Err(ServerError::NotFound);
            }
            projects::grant(conn, project, account, role, row.owner, now)?;
            security_log::record(
                conn,
                now,
                NewSecurityEvent {
                    actor: Some(row.owner),
                    kind: if existing.is_some() {
                        SecurityEventKind::ProjectAccessChanged
                    } else {
                        SecurityEventKind::ProjectAccessGranted
                    },
                    target: Some(account.to_string()),
                    ip: None,
                    detail: json!({ "project": project.to_string(), "role": projects::role_to_str(role) }),
                },
            )?;
            Ok(true)
        })
        .await?;
    if changed {
        state.rooms.notify_account(
            project,
            account,
            &ServerFrame::AccessChanged {
                project_id: project,
                role: Some(role),
                change: None,
                comments: None,
            },
        );
    }
    Ok(changed)
}

pub async fn find_shared_project(
    state: &AppState,
    title: Option<&str>,
) -> Result<Option<(SharedProjectId, String)>, ServerError> {
    let title = title.map(str::to_owned);
    state
        .db
        .call(move |conn| {
            let found: Option<(String, String)> = conn
                .query_row(
                    "SELECT id, title FROM projects WHERE status = 'active' AND (?1 IS NULL OR title = ?1) ORDER BY created_at DESC, id DESC LIMIT 1",
                    params![title],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()?;
            found
                .map(|(id, title)| parse_id(&id).map(|id| (id, title)))
                .transpose()
        })
        .await
}

pub async fn project_log(
    state: &AppState,
    project: SharedProjectId,
) -> Result<ProjectLog, ServerError> {
    state
        .db
        .call(move |conn| {
            let head_seq = projects::project_row(conn, project)?
                .ok_or(ServerError::NotFound)?
                .head_seq;
            let oldest_kept = projects::oldest_kept_update(conn, project)?;
            let (kept_updates, kept_bytes): (i64, i64) = conn.query_row(
                "SELECT COUNT(*), COALESCE(SUM(LENGTH(envelope)), 0) FROM project_updates WHERE project_id = ?1",
                params![project.to_string()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
            let mut statement = conn.prepare(
                "SELECT seq, file FROM project_snapshots WHERE project_id = ?1 ORDER BY seq",
            )?;
            let snapshots = statement
                .query_map(params![project.to_string()], |row| {
                    Ok((
                        u64::try_from(row.get::<_, i64>(0)?).unwrap_or(0),
                        row.get::<_, String>(1)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            Ok(ProjectLog {
                head_seq,
                oldest_kept,
                kept_updates: u64::try_from(kept_updates).unwrap_or(0),
                kept_bytes: u64::try_from(kept_bytes).unwrap_or(0),
                snapshots,
            })
        })
        .await
}

pub async fn serve_until<F>(
    state: AppState,
    listener: tokio::net::TcpListener,
    shutdown: F,
) -> std::io::Result<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    let app = build_router(state).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
}

pub fn init_dev_logging(quiet_targets: &[&str]) {
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::util::SubscriberInitExt;
    let filter = quiet_targets.iter().fold(
        tracing_subscriber::filter::Targets::new().with_default(tracing::Level::INFO),
        |filter, target| filter.with_target(*target, tracing::Level::WARN),
    );
    let _ = tracing_subscriber::registry()
        .with(
            tracing_subscriber::fmt::layer()
                .with_ansi(false)
                .with_target(false),
        )
        .with(filter)
        .try_init();
}
