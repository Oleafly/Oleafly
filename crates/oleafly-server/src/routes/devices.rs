use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get};
use axum::{Json, Router};
use oleafly_collab_protocol::admin::SecurityEventKind;
use oleafly_collab_protocol::auth::{AccountSummary, DeviceSummary};
use oleafly_collab_protocol::ids::DeviceId;
use serde_json::json;

use crate::auth::devices;
use crate::error::ServerError;
use crate::members;
use crate::routes::{Authenticated, ClientIp};
use crate::security_log::{self, NewSecurityEvent};
use crate::state::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/me", get(me))
        .route("/api/v1/devices", get(list_devices))
        .route("/api/v1/devices/{device_id}", delete(sign_out_device))
}

async fn me(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<AccountSummary>, ServerError> {
    let account = auth.account_id;
    let summary = state
        .db
        .call(move |conn| members::account_summary(conn, account))
        .await?
        .ok_or(ServerError::NotFound)?;
    Ok(Json(summary))
}

async fn list_devices(
    State(state): State<AppState>,
    auth: Authenticated,
) -> Result<Json<Vec<DeviceSummary>>, ServerError> {
    let account = auth.account_id;
    let current = auth.device_id;
    let listed = state
        .db
        .call(move |conn| devices::list_for_account(conn, account, current))
        .await?;
    Ok(Json(listed))
}

async fn sign_out_device(
    State(state): State<AppState>,
    ClientIp(ip): ClientIp,
    auth: Authenticated,
    Path(raw): Path<String>,
) -> Result<StatusCode, ServerError> {
    let device: DeviceId = raw.parse().map_err(|_| ServerError::NotFound)?;
    let account = auth.account_id;
    let now = state.clock.now_ms();
    let owned = state
        .db
        .call(move |conn| {
            let owned = devices::find(conn, device)?
                .is_some_and(|record| record.account_id == account && !record.revoked);
            if owned {
                security_log::record(
                    conn,
                    now,
                    NewSecurityEvent {
                        actor: Some(account),
                        kind: SecurityEventKind::DeviceSignedOut,
                        target: Some(device.to_string()),
                        ip,
                        detail: json!({ "by": "owner" }),
                    },
                )?;
            }
            Ok(owned)
        })
        .await?;
    if !owned {
        return Err(ServerError::NotFound);
    }
    state.revoke_device(device).await?;
    Ok(StatusCode::NO_CONTENT)
}
