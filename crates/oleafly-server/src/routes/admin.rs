use axum::extract::rejection::{JsonRejection, PathRejection, QueryRejection};
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, patch};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::{
    AllowlistEntry, AllowlistMatcher, DomainRule, MemberPatch, MemberStatus, MemberSummary,
    NewAllowlistEntry, NewDomainRule, Page, RuntimeSettings, RuntimeSettingsPatch, SecurityEvent,
    SecurityEventKind,
};
use oleafly_collab_protocol::auth::{DeviceSummary, SessionEndReason};
use oleafly_collab_protocol::capabilities::ProviderKind;
use oleafly_collab_protocol::ids::{AccountId, DeviceId};
use oleafly_collab_protocol::roles::{ServerAction, ServerRole};
use rusqlite::Connection;
use serde::Deserialize;
use serde_json::{json, Value};

use crate::error::ServerError;
use crate::mail::notify;
use crate::members;
use crate::routes::{json_body, path_id, Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::settings;
use crate::state::AppState;

const LAST_ADMIN: &str = "This is the server's only admin. Make someone else an admin first.";

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/admin/members", get(list_members))
        .route(
            "/api/v1/admin/members/{account_id}",
            patch(patch_member).delete(remove_member),
        )
        .route(
            "/api/v1/admin/members/{account_id}/devices",
            get(member_devices),
        )
        .route("/api/v1/admin/devices/{device_id}", delete(sign_out_device))
        .route(
            "/api/v1/admin/allowlist",
            get(list_allowlist).post(add_allowlist),
        )
        .route(
            "/api/v1/admin/allowlist/{entry_id}",
            delete(remove_allowlist),
        )
        .route("/api/v1/admin/domains", get(list_domains).post(add_domain))
        .route("/api/v1/admin/domains/{rule_id}", delete(remove_domain))
        .route(
            "/api/v1/admin/settings",
            get(get_settings).patch(patch_settings),
        )
        .route("/api/v1/admin/security-log", get(security_log_page))
}

fn event(
    actor: AccountId,
    kind: SecurityEventKind,
    target: Option<String>,
    ip: Option<String>,
    detail: Value,
) -> NewSecurityEvent {
    NewSecurityEvent {
        actor: Some(actor),
        kind,
        target,
        ip,
        detail,
    }
}

fn allowlist_detail(matcher: &AllowlistMatcher, role: ServerRole) -> Value {
    match matcher {
        AllowlistMatcher::Email { email } => json!({
            "kind": "email",
            "email": email,
            "role": members::role_to_str(role),
        }),
        AllowlistMatcher::ProviderLogin { provider, login } => json!({
            "kind": "provider_login",
            "provider": provider,
            "login": login,
            "role": members::role_to_str(role),
        }),
    }
}

fn existing_member(conn: &Connection, account: AccountId) -> Result<MemberSummary, ServerError> {
    match members::member_summary(conn, account)? {
        Some(member) if !matches!(member.status, MemberStatus::Removed) => Ok(member),
        _ => Err(ServerError::NotFound),
    }
}

fn require_staff_rights(
    auth: Authenticated,
    owner: AccountId,
    role: ServerRole,
) -> Result<(), ServerError> {
    if members::is_staff(role) && owner != auth.account_id {
        auth.require(ServerAction::ManageStaff)?;
    }
    Ok(())
}

async fn member_devices(
    State(state): State<AppState>,
    auth: Authenticated,
    path: Result<Path<String>, PathRejection>,
) -> Result<Json<Vec<DeviceSummary>>, ServerError> {
    auth.require(ServerAction::SignOutAnyDevice)?;
    let target: AccountId = path_id(path)?;
    let devices = state
        .db
        .call(move |conn| {
            let member = existing_member(conn, target)?;
            require_staff_rights(auth, target, member.account.server_role)?;
            members::device_summaries(conn, target)
        })
        .await?;
    Ok(Json(devices))
}

async fn list_members(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<MemberSummary>>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let listed = state.db.call(|conn| members::list_members(conn)).await?;
    Ok(Json(listed))
}

async fn patch_member(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
    body: Result<Json<MemberPatch>, JsonRejection>,
) -> Result<Json<MemberSummary>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let target: AccountId = path_id(path)?;
    let change = json_body(body)?;
    if change.role.is_none() && change.status.is_none() {
        return Err(ServerError::BadRequest(
            "Send a role or a status to change.".to_string(),
        ));
    }
    if matches!(change.status, Some(MemberStatus::Removed)) {
        return Err(ServerError::BadRequest(
            "To take someone off the server, remove them instead.".to_string(),
        ));
    }
    let now = state.clock.now_ms();
    let (summary, signed_out) = state
        .db
        .call(move |conn| apply_member_patch(conn, auth, target, &change, ip, now))
        .await?;
    for device in signed_out {
        state
            .end_device_session(device, SessionEndReason::AccountSuspended)
            .await?;
    }
    Ok(Json(summary))
}

fn apply_member_patch(
    conn: &mut Connection,
    auth: Authenticated,
    target: AccountId,
    change: &MemberPatch,
    ip: Option<String>,
    now: i64,
) -> Result<(MemberSummary, Vec<DeviceId>), ServerError> {
    let transaction = conn.transaction()?;
    let current = existing_member(&transaction, target)?;
    let old_role = current.account.server_role;
    let new_role = change.role.unwrap_or(old_role);
    let was_active = matches!(current.status, MemberStatus::Active);
    let will_be_active = change
        .status
        .as_ref()
        .map_or(was_active, |status| matches!(status, MemberStatus::Active));
    let role_changes = new_role != old_role;
    let status_changes = will_be_active != was_active;
    let touches_staff = (role_changes
        && (members::is_staff(old_role) || members::is_staff(new_role)))
        || (status_changes && members::is_staff(old_role));
    if touches_staff {
        auth.require(ServerAction::ManageStaff)?;
    }
    let loses_admin = old_role == ServerRole::Admin
        && was_active
        && (new_role != ServerRole::Admin || !will_be_active);
    if loses_admin && members::count_admins(&transaction)? <= 1 {
        return Err(ServerError::Conflict(LAST_ADMIN.to_string()));
    }
    let target_text = target.to_string();
    if role_changes {
        members::set_role(&transaction, target, new_role, now)?;
        security_log::record(
            &transaction,
            now,
            event(
                auth.account_id,
                SecurityEventKind::RoleChanged,
                Some(target_text.clone()),
                ip.clone(),
                json!({
                    "from": members::role_to_str(old_role),
                    "to": members::role_to_str(new_role),
                }),
            ),
        )?;
    }
    let mut signed_out = Vec::new();
    if status_changes && will_be_active {
        members::set_status(&transaction, target, &MemberStatus::Active, now)?;
        security_log::record(
            &transaction,
            now,
            event(
                auth.account_id,
                SecurityEventKind::MemberReactivated,
                Some(target_text),
                ip,
                json!({}),
            ),
        )?;
    } else if status_changes {
        signed_out = members::account_devices(&transaction, target)?;
        members::set_status(&transaction, target, &MemberStatus::Suspended, now)?;
        security_log::record(
            &transaction,
            now,
            event(
                auth.account_id,
                SecurityEventKind::MemberSuspended,
                Some(target_text),
                ip,
                json!({ "devices_signed_out": signed_out.len() }),
            ),
        )?;
    }
    let summary = members::member_summary(&transaction, target)?.ok_or(ServerError::NotFound)?;
    transaction.commit()?;
    Ok((summary, signed_out))
}

async fn remove_member(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let target: AccountId = path_id(path)?;
    let now = state.clock.now_ms();
    let signed_out = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let current = existing_member(&transaction, target)?;
            let role = current.account.server_role;
            if members::is_staff(role) {
                auth.require(ServerAction::ManageStaff)?;
            }
            if role == ServerRole::Admin
                && matches!(current.status, MemberStatus::Active)
                && members::count_admins(&transaction)? <= 1
            {
                return Err(ServerError::Conflict(LAST_ADMIN.to_string()));
            }
            let devices = members::account_devices(&transaction, target)?;
            let unbound = members::remove_account(&transaction, target, now)?;
            security_log::record(
                &transaction,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::MemberRemoved,
                    Some(target.to_string()),
                    ip,
                    json!({
                        "display_name": current.account.display_name,
                        "role": members::role_to_str(role),
                        "devices_signed_out": devices.len(),
                        "allowlist_entries_removed": unbound,
                    }),
                ),
            )?;
            transaction.commit()?;
            Ok(devices)
        })
        .await?;
    for device in signed_out {
        state
            .end_device_session(device, SessionEndReason::AccessEnded)
            .await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn sign_out_device(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    auth.require(ServerAction::SignOutAnyDevice)?;
    let device: DeviceId = path_id(path)?;
    let owner = state
        .db
        .call(move |conn| {
            let owner = members::device_owner(conn, device)?.ok_or(ServerError::NotFound)?;
            let role = members::account_role(conn, owner)?.ok_or(ServerError::NotFound)?;
            require_staff_rights(auth, owner, role)?;
            Ok(owner)
        })
        .await?;
    state.revoke_device(device).await?;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            security_log::record(
                conn,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::DeviceSignedOut,
                    Some(device.to_string()),
                    ip,
                    json!({ "account_id": owner.to_string() }),
                ),
            )
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_allowlist(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<AllowlistEntry>>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let entries = state.db.call(|conn| members::list_allowlist(conn)).await?;
    Ok(Json(entries))
}

async fn add_allowlist(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    body: Result<Json<NewAllowlistEntry>, JsonRejection>,
) -> Result<(StatusCode, Json<AllowlistEntry>), ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let entry = json_body(body)?;
    if members::is_staff(entry.role) {
        auth.require(ServerAction::ManageStaff)?;
    }
    if let AllowlistMatcher::ProviderLogin { provider, .. } = &entry.matcher {
        let infos = state.providers.infos();
        let Some(info) = infos.iter().find(|info| info.id == *provider) else {
            return Err(ServerError::BadRequest(format!(
                "This server has no sign-in provider called {provider}."
            )));
        };
        if !matches!(info.kind, ProviderKind::Github) {
            return Err(ServerError::BadRequest(
                "Sign-in names work only with GitHub. Add this person by email address instead."
                    .to_string(),
            ));
        }
    }
    let now = state.clock.now_ms();
    let created = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let created = members::add_allowlist(&transaction, &entry, Some(auth.account_id), now)?;
            security_log::record(
                &transaction,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::AllowlistAdded,
                    Some(created.id.clone()),
                    ip,
                    allowlist_detail(&created.matcher, created.role),
                ),
            )?;
            transaction.commit()?;
            Ok(created)
        })
        .await?;
    if let AllowlistMatcher::Email { email } = &created.matcher {
        notify::added_to_server(&state, email.clone(), created.role);
    }
    Ok((StatusCode::CREATED, Json(created)))
}

async fn remove_allowlist(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let entry_id: String = path_id(path)?;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let entry =
                members::get_allowlist(&transaction, &entry_id)?.ok_or(ServerError::NotFound)?;
            if members::is_staff(entry.role) {
                auth.require(ServerAction::ManageStaff)?;
            }
            members::remove_allowlist(&transaction, &entry_id)?;
            security_log::record(
                &transaction,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::AllowlistRemoved,
                    Some(entry_id),
                    ip,
                    allowlist_detail(&entry.matcher, entry.role),
                ),
            )?;
            transaction.commit()?;
            Ok(())
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn list_domains(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<DomainRule>>, ServerError> {
    auth.require(ServerAction::ManageDomainRules)?;
    let rules = state
        .db
        .call(|conn| members::list_domain_rules(conn))
        .await?;
    Ok(Json(rules))
}

async fn add_domain(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    body: Result<Json<NewDomainRule>, JsonRejection>,
) -> Result<(StatusCode, Json<DomainRule>), ServerError> {
    auth.require(ServerAction::ManageDomainRules)?;
    let rule = json_body(body)?;
    let now = state.clock.now_ms();
    let created = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let created =
                members::add_domain_rule(&transaction, &rule, Some(auth.account_id), now)?;
            security_log::record(
                &transaction,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::DomainRuleAdded,
                    Some(created.id.clone()),
                    ip,
                    json!({
                        "domain": created.domain,
                        "role": members::role_to_str(created.role),
                    }),
                ),
            )?;
            transaction.commit()?;
            Ok(created)
        })
        .await?;
    Ok((StatusCode::CREATED, Json(created)))
}

async fn remove_domain(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    path: Result<Path<String>, PathRejection>,
) -> Result<StatusCode, ServerError> {
    auth.require(ServerAction::ManageDomainRules)?;
    let rule_id: String = path_id(path)?;
    let now = state.clock.now_ms();
    state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let rule =
                members::get_domain_rule(&transaction, &rule_id)?.ok_or(ServerError::NotFound)?;
            members::remove_domain_rule(&transaction, &rule_id)?;
            security_log::record(
                &transaction,
                now,
                event(
                    auth.account_id,
                    SecurityEventKind::DomainRuleRemoved,
                    Some(rule_id),
                    ip,
                    json!({
                        "domain": rule.domain,
                        "role": members::role_to_str(rule.role),
                    }),
                ),
            )?;
            transaction.commit()?;
            Ok(())
        })
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn get_settings(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<RuntimeSettings>, ServerError> {
    auth.require(ServerAction::ManageMembers)?;
    let current = state.db.call(|conn| settings::load(conn)).await?;
    Ok(Json(current))
}

async fn patch_settings(
    State(state): State<AppState>,
    auth: Authenticated,
    ClientIp(ip): ClientIp,
    body: Result<Json<RuntimeSettingsPatch>, JsonRejection>,
) -> Result<Json<RuntimeSettings>, ServerError> {
    auth.require(ServerAction::ChangeSettings)?;
    let change = json_body(body)?;
    let now = state.clock.now_ms();
    let (updated, comments_switched) = state
        .db
        .call(move |conn| {
            let transaction = conn.transaction()?;
            let before = settings::load(&transaction)?;
            let after = settings::patch(&transaction, &change)?;
            let differences = settings::differences(&before, &after);
            if !differences.is_empty() {
                security_log::record(
                    &transaction,
                    now,
                    event(
                        auth.account_id,
                        SecurityEventKind::SettingsChanged,
                        None,
                        ip,
                        Value::Object(differences),
                    ),
                )?;
            }
            transaction.commit()?;
            Ok((after, before.comments_allowed != after.comments_allowed))
        })
        .await?;
    if comments_switched {
        for project in state.rooms.projects() {
            crate::routes::projects::tell_comment_switches(&state, project).await;
        }
    }
    Ok(Json(updated))
}

#[derive(Deserialize)]
struct SecurityLogQuery {
    cursor: Option<String>,
}

async fn security_log_page(
    State(state): State<AppState>,
    auth: Authenticated,
    query: Result<Query<SecurityLogQuery>, QueryRejection>,
) -> Result<Json<Page<SecurityEvent>>, ServerError> {
    auth.require(ServerAction::ReadSecurityLog)?;
    let Query(query) = query.map_err(|rejection| ServerError::BadRequest(rejection.body_text()))?;
    let cursor = query.cursor.filter(|value| !value.is_empty());
    let listed = state
        .db
        .call(move |conn| {
            security_log::page(conn, cursor.as_deref(), security_log::DEFAULT_PAGE_SIZE)
        })
        .await?;
    Ok(Json(listed))
}
