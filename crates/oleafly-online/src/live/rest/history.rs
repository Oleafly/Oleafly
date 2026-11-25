use std::collections::BTreeSet;
use std::path::Path;
use std::time::Duration;

use serde_json::{json, Value};

use super::{json_of, judged, sent_error, transient, Judged, ProjectRest, RestError};
use crate::error::{OnlineError, OnlineErrorKind};
use crate::realtime::events::{plain_id, stamp_ms, EntityId, ReviewUser};
use crate::realtime::tree::NodeKind;
use crate::session::SessionHandle;

pub const HISTORY_DEADLINE: Duration = Duration::from_secs(30);
pub const RESTORE_DEADLINE: Duration = Duration::from_secs(5 * 60);
pub const ZIP_DEADLINE: Duration = Duration::from_secs(8 * 60);
const MAX_PATH_BYTES: usize = 4096;

#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum HistoryError {
    #[error("this plan keeps no history to download")]
    PlanLimit,
    #[error("that version or file is not in the history")]
    Missing,
    #[error("this server can't put a version back over the current files")]
    CannotRevert,
    #[error("not a valid history request: {0}")]
    Invalid(&'static str),
    #[error("no reply within {} s", .0.as_secs())]
    TimedOut(Duration),
    #[error("the download could not be saved: {0}")]
    Saving(String),
    #[error(transparent)]
    Rest(RestError),
}

impl HistoryError {
    pub fn is_temporary(&self) -> bool {
        match self {
            HistoryError::TimedOut(_) => true,
            HistoryError::Rest(error) => error.is_temporary(),
            HistoryError::PlanLimit
            | HistoryError::Missing
            | HistoryError::CannotRevert
            | HistoryError::Invalid(_)
            | HistoryError::Saving(_) => false,
        }
    }
}

impl From<RestError> for HistoryError {
    fn from(error: RestError) -> HistoryError {
        match error {
            RestError::Refused { status: 402, .. } => HistoryError::PlanLimit,
            RestError::Refused { status: 404, .. } => HistoryError::Missing,
            other => HistoryError::Rest(other),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryLabel {
    pub id: String,
    pub comment: String,
    pub version: u64,
    pub user_id: Option<String>,
    pub created_ms: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HistoryUpdate {
    pub from: u64,
    pub to: u64,
    pub start_ms: i64,
    pub end_ms: i64,
    pub users: Vec<ReviewUser>,
    pub labels: Vec<HistoryLabel>,
    pub paths: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UpdatesPage {
    pub updates: Vec<HistoryUpdate>,
    pub next_before: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TreeOp {
    Edited,
    Added,
    Removed,
    Renamed,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeDiffEntry {
    pub path: String,
    pub op: Option<TreeOp>,
    pub new_path: Option<String>,
    pub deleted_at: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DocAtVersion {
    Text(String),
    Binary,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Restored {
    pub id: EntityId,
    pub kind: NodeKind,
    pub path: Option<String>,
}

fn server_failed(error: &RestError) -> bool {
    matches!(error, RestError::ServerFailed { status: 500, .. })
}

fn text(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(Value::as_str).map(str::to_string)
}

fn id_of(value: &Value, key: &str) -> Option<String> {
    text(value, key).filter(|id| plain_id(id))
}

fn label_of(value: &Value) -> Option<HistoryLabel> {
    Some(HistoryLabel {
        id: id_of(value, "id")?,
        comment: text(value, "comment").unwrap_or_default(),
        version: value.get("version").and_then(Value::as_u64)?,
        user_id: id_of(value, "user_id"),
        created_ms: value.get("created_at").and_then(stamp_ms),
    })
}

fn op_paths(op: &Value) -> impl Iterator<Item = String> + '_ {
    ["add", "remove", "rename"]
        .into_iter()
        .filter_map(|kind| op.get(kind))
        .flat_map(|entry| {
            ["pathname", "newPathname"]
                .into_iter()
                .filter_map(|key| text(entry, key))
        })
}

fn update_of(value: &Value) -> Option<HistoryUpdate> {
    let meta = value.get("meta");
    let stamp = |key: &str| meta.and_then(|meta| meta.get(key)).and_then(stamp_ms);
    let start_ms = stamp("start_ts").unwrap_or_default();
    let listed = |key: &str| {
        value
            .get(key)
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
    };
    let paths: BTreeSet<String> = listed("pathnames")
        .iter()
        .filter_map(|path| path.as_str().map(str::to_string))
        .chain(listed("project_ops").iter().flat_map(op_paths))
        .filter(|path| !path.is_empty())
        .collect();
    let mut labels: Vec<HistoryLabel> = listed("labels").iter().filter_map(label_of).collect();
    labels.sort_by_key(|label| std::cmp::Reverse(label.created_ms));
    Some(HistoryUpdate {
        from: value.get("fromV")?.as_u64()?,
        to: value.get("toV")?.as_u64()?,
        start_ms,
        end_ms: stamp("end_ts").unwrap_or(start_ms),
        users: meta
            .and_then(|meta| meta.get("users"))
            .and_then(Value::as_array)
            .map(Vec::as_slice)
            .unwrap_or_default()
            .iter()
            .filter_map(ReviewUser::from_value)
            .collect(),
        labels,
        paths: paths.into_iter().collect(),
    })
}

fn tree_op(name: &str) -> Option<TreeOp> {
    Some(match name {
        "edited" => TreeOp::Edited,
        "added" => TreeOp::Added,
        "removed" => TreeOp::Removed,
        "renamed" => TreeOp::Renamed,
        _ => return None,
    })
}

fn diff_entry(value: &Value) -> Option<TreeDiffEntry> {
    Some(TreeDiffEntry {
        path: text(value, "pathname").filter(|path| !path.is_empty())?,
        op: text(value, "operation").as_deref().and_then(tree_op),
        new_path: text(value, "newPathname"),
        deleted_at: value.get("deletedAtV").and_then(Value::as_u64),
    })
}

fn kind_of(value: &Value) -> NodeKind {
    match value.get("type").and_then(Value::as_str) {
        Some("doc") => NodeKind::Doc,
        _ => NodeKind::File,
    }
}

fn restored_of(value: &Value) -> Option<Restored> {
    Some(Restored {
        id: EntityId(id_of(value, "id")?),
        kind: kind_of(value),
        path: text(value, "path"),
    })
}

fn checked_path(path: &str) -> Result<&str, HistoryError> {
    let path = path.trim_start_matches('/');
    let bad = path.is_empty()
        || path.len() > MAX_PATH_BYTES
        || path.contains('\0')
        || path.split('/').any(|part| part.is_empty() || part == "..");
    if bad {
        Err(HistoryError::Invalid("a path that can't be in a project"))
    } else {
        Ok(path)
    }
}

fn encoded(text: &str) -> String {
    url::form_urlencoded::byte_serialize(text.as_bytes()).collect()
}

fn archive_error(error: OnlineError) -> HistoryError {
    match error.kind {
        OnlineErrorKind::TooLarge => HistoryError::Rest(RestError::TooLarge),
        OnlineErrorKind::NotAnArchive => HistoryError::Rest(RestError::Unreadable(
            "the reply is not a zip archive".into(),
        )),
        OnlineErrorKind::Io => HistoryError::Saving(error.to_string()),
        _ => HistoryError::Rest(RestError::Lost(error.to_string())),
    }
}

impl ProjectRest {
    pub async fn updates(
        &self,
        session: &SessionHandle,
        before: Option<u64>,
        min_count: usize,
    ) -> Result<UpdatesPage, HistoryError> {
        let mut path = self.route(&format!("/updates?min_count={}", min_count.max(1)));
        if let Some(before) = before {
            path.push_str(&format!("&before={before}"));
        }
        let reply = json_of(self.get(session, &path).await?).await?;
        let updates = reply
            .get("updates")
            .and_then(Value::as_array)
            .ok_or_else(|| RestError::Unreadable("the history has no updates list".into()))?;
        Ok(UpdatesPage {
            updates: updates.iter().filter_map(update_of).collect(),
            next_before: reply.get("nextBeforeTimestamp").and_then(Value::as_u64),
        })
    }

    pub async fn tree_diff(
        &self,
        session: &SessionHandle,
        from: u64,
        to: u64,
    ) -> Result<Vec<TreeDiffEntry>, HistoryError> {
        let path = self.route(&format!("/filetree/diff?from={from}&to={to}"));
        let reply = json_of(self.get(session, &path).await?).await?;
        let diff = reply
            .get("diff")
            .and_then(Value::as_array)
            .ok_or_else(|| RestError::Unreadable("the file diff is not a list".into()))?;
        Ok(diff.iter().filter_map(diff_entry).collect())
    }

    pub async fn doc_at(
        &self,
        session: &SessionHandle,
        version: u64,
        path: &str,
    ) -> Result<DocAtVersion, HistoryError> {
        let pathname = checked_path(path)?;
        let route = self.route(&format!(
            "/diff?from={version}&to={version}&pathname={}",
            encoded(pathname)
        ));
        let response = match self
            .get_retrying(session, &route, |error| {
                transient(error) && !server_failed(error)
            })
            .await
        {
            Err(error) if server_failed(&error) => return Err(HistoryError::Missing),
            other => other?,
        };
        let reply = json_of(response).await?;
        match reply.get("diff") {
            Some(Value::Array(parts)) => Ok(DocAtVersion::Text(
                parts
                    .iter()
                    .filter_map(|part| part.get("u").or_else(|| part.get("i")))
                    .filter_map(Value::as_str)
                    .collect(),
            )),
            Some(Value::Object(diff))
                if diff.get("binary").and_then(Value::as_bool) == Some(true) =>
            {
                Ok(DocAtVersion::Binary)
            }
            _ => Err(RestError::Unreadable("the version text is not a diff".into()).into()),
        }
    }

    pub async fn labels(&self, session: &SessionHandle) -> Result<Vec<HistoryLabel>, HistoryError> {
        let reply = json_of(self.get(session, &self.route("/labels")).await?).await?;
        let labels = reply
            .as_array()
            .ok_or_else(|| RestError::Unreadable("the labels are not a list".into()))?;
        Ok(labels.iter().filter_map(label_of).collect())
    }

    pub async fn add_label(
        &self,
        session: &SessionHandle,
        version: u64,
        comment: &str,
    ) -> Result<HistoryLabel, HistoryError> {
        if comment.trim().is_empty() {
            return Err(HistoryError::Invalid("an empty version name"));
        }
        let route = self.route("/labels");
        let body = json!({ "comment": comment, "version": version });
        let response = self
            .write(session, |cookie| self.http.post(&route, cookie).json(&body))
            .await?;
        label_of(&json_of(response).await?)
            .ok_or_else(|| RestError::Unreadable("the new label has no id".into()).into())
    }

    pub async fn delete_label(
        &self,
        session: &SessionHandle,
        label: &str,
    ) -> Result<(), HistoryError> {
        if !plain_id(label) {
            return Err(HistoryError::Invalid(
                "a label id with unexpected characters",
            ));
        }
        let route = self.route(&format!("/labels/{label}"));
        match self
            .write(session, |cookie| self.http.delete(&route, cookie))
            .await
        {
            Ok(_) | Err(RestError::Refused { status: 404, .. }) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }

    async fn restore(
        &self,
        session: &SessionHandle,
        route: &str,
        body: &Value,
        failed: HistoryError,
    ) -> Result<Value, HistoryError> {
        let route = self.route(route);
        let written = self
            .write(session, |cookie| {
                self.http
                    .post_unhurried(&route, cookie, RESTORE_DEADLINE)
                    .json(body)
            })
            .await;
        match written {
            Err(error) if server_failed(&error) => Err(failed),
            Err(error) => Err(error.into()),
            Ok(response) => Ok(json_of(response).await?),
        }
    }

    async fn restore_path(
        &self,
        session: &SessionHandle,
        route: &str,
        version: u64,
        path: &str,
        failed: HistoryError,
    ) -> Result<Restored, HistoryError> {
        let body = json!({ "version": version, "pathname": checked_path(path)? });
        let reply = self.restore(session, route, &body, failed).await?;
        restored_of(&reply)
            .ok_or_else(|| RestError::Unreadable("the restore has no id".into()).into())
    }

    pub async fn revert_file(
        &self,
        session: &SessionHandle,
        version: u64,
        path: &str,
    ) -> Result<Restored, HistoryError> {
        self.restore_path(
            session,
            "/revert_file",
            version,
            path,
            HistoryError::CannotRevert,
        )
        .await
    }

    pub async fn restore_file(
        &self,
        session: &SessionHandle,
        version: u64,
        path: &str,
    ) -> Result<Restored, HistoryError> {
        self.restore_path(
            session,
            "/restore_file",
            version,
            path,
            HistoryError::Missing,
        )
        .await
    }

    pub async fn revert_project(
        &self,
        session: &SessionHandle,
        version: u64,
    ) -> Result<Vec<Restored>, HistoryError> {
        let body = json!({ "version": version });
        let reply = self
            .restore(
                session,
                "/revert-project",
                &body,
                HistoryError::CannotRevert,
            )
            .await?;
        let reverted = reply
            .as_array()
            .ok_or_else(|| RestError::Unreadable("the project restore is not a list".into()))?;
        Ok(reverted.iter().filter_map(restored_of).collect())
    }

    pub async fn version_zip(
        &self,
        session: &SessionHandle,
        version: u64,
        destination: &Path,
        progress: impl FnMut(u64, Option<u64>),
    ) -> Result<u64, HistoryError> {
        let route = self.route(&format!("/version/{version}/zip"));
        let response = self
            .http
            .get_unhurried(&route, &session.cookie())
            .send()
            .await
            .map_err(sent_error)?;
        session.absorb_headers(response.headers());
        let response = match judged(response).await {
            Judged::Fine(response) => response,
            Judged::StaleToken(_) => {
                return Err(self
                    .signed_out_or(session, RestError::NotAllowed)
                    .await
                    .into());
            }
            Judged::Failed(error) => return Err(self.signed_out_or(session, error).await.into()),
        };
        self.http
            .save_archive(response, destination, progress)
            .await
            .map_err(archive_error)
    }
}

#[cfg(test)]
mod tests;
