use std::sync::Arc;

use oleafly_collab::CollabError;
use oleafly_online::live::session::{ConnectionDetails, Resolution};
use oleafly_online::realtime::DocId;
use serde::{Deserialize, Serialize};

use super::{live_error, OverleafLive};
use crate::collab::commands::CollabCommandError;
use crate::collab::live::session::{live_for, not_live, Live};

pub(crate) const OVERLEAF_NOTICE_EVENT: &str = "overleaf-live-notice";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OverleafNotice {
    Merged {
        path: String,
        before: String,
        after: String,
    },
    NeedsReview {
        path: String,
        mine: String,
        theirs: String,
    },
    Maintenance {
        message: String,
        #[serde(rename = "delayMs")]
        delay_ms: u64,
    },
    SlowAck {
        waiting: bool,
    },
    Unsteady {
        path: String,
    },
    Fault {
        path: String,
        reason: String,
    },
    External {
        path: String,
    },
    Replaced {
        path: String,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverleafNoticePayload {
    pub project_id: String,
    #[serde(flatten)]
    pub notice: OverleafNotice,
}

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Keep {
    Mine,
    Theirs,
}

fn live_doc(project_id: &str, path: &str) -> Result<(Arc<OverleafLive>, DocId), CollabError> {
    let Some(Live::Overleaf(live)) = live_for(project_id) else {
        return Err(not_live());
    };
    let doc = live.doc_at(path).ok_or_else(not_live)?;
    Ok((live, doc))
}

pub(crate) fn resolve(project_id: &str, path: &str, keep: Keep) -> Result<(), CollabError> {
    let (live, doc) = live_doc(project_id, path)?;
    let choice = match keep {
        Keep::Mine => Resolution::Mine,
        Keep::Theirs => Resolution::Theirs,
    };
    live.session.resolve(&doc, choice).map_err(live_error)
}

pub(crate) fn retry(project_id: &str, path: &str) -> Result<(), CollabError> {
    let (live, doc) = live_doc(project_id, path)?;
    live.session.retry(&doc).map_err(live_error)
}

pub(crate) fn keep_copy(project_id: &str, path: &str) -> Result<(), CollabError> {
    let (live, doc) = live_doc(project_id, path)?;
    live.session.keep_and_reload(&doc).map_err(live_error)
}

#[tauri::command]
pub async fn overleaf_live_resolve(
    project_id: String,
    path: String,
    keep: Keep,
) -> Result<(), CollabCommandError> {
    resolve(&project_id, &path, keep).map_err(CollabCommandError::from)
}

async fn on_disk(
    work: impl FnOnce() -> Result<(), CollabError> + Send + 'static,
) -> Result<(), CollabCommandError> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| CollabCommandError::from(CollabError::Io(error.to_string())))?
        .map_err(CollabCommandError::from)
}

#[tauri::command]
pub async fn overleaf_live_retry(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    on_disk(move || retry(&project_id, &path)).await
}

#[tauri::command]
pub async fn overleaf_live_keep_copy(
    project_id: String,
    path: String,
) -> Result<(), CollabCommandError> {
    on_disk(move || keep_copy(&project_id, &path)).await
}

#[tauri::command]
pub async fn overleaf_live_connection_details(
    project_id: String,
) -> Result<ConnectionDetails, CollabCommandError> {
    match live_for(&project_id) {
        Some(Live::Overleaf(live)) => Ok(live.session.details()),
        Some(Live::Server(_)) | None => Err(CollabCommandError::from(not_live())),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{OverleafNotice, OverleafNoticePayload};

    #[test]
    fn a_notice_reaches_the_page_flat_and_camel_cased() {
        let payload = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::Maintenance {
                message: "Back <b>soon</b>".into(),
                delay_ms: 1_000,
            },
        };
        assert_eq!(
            serde_json::to_value(&payload).unwrap(),
            json!({ "projectId": "p1", "kind": "maintenance", "message": "Back <b>soon</b>", "delayMs": 1000 })
        );
        let review = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::NeedsReview {
                path: "main.tex".into(),
                mine: "a".into(),
                theirs: "b".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&review).unwrap(),
            json!({ "projectId": "p1", "kind": "needs_review", "path": "main.tex", "mine": "a", "theirs": "b" })
        );
        let fault = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::Fault {
                path: "main.tex".into(),
                reason: "too_long".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&fault).unwrap(),
            json!({ "projectId": "p1", "kind": "fault", "path": "main.tex", "reason": "too_long" })
        );
        let external = OverleafNoticePayload {
            project_id: "p1".into(),
            notice: OverleafNotice::External {
                path: "main.tex".into(),
            },
        };
        assert_eq!(
            serde_json::to_value(&external).unwrap(),
            json!({ "projectId": "p1", "kind": "external", "path": "main.tex" })
        );
    }
}
