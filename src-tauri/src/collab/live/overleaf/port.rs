use std::sync::Arc;

use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::error::{OnlineError, OnlineErrorKind};
use oleafly_online::live::session::{
    Account, DocStopReason, LiveEnd, LivePort, LiveState, MergeReview,
};
use oleafly_online::realtime::events::{PeerPosition, ProjectEvent, PublicId};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::PathChange;
use oleafly_online::realtime::DocId;
use oleafly_ot::DocMessage;

use super::Mirror;
use crate::collab::live::kept::{KeptFile, KeptKind};
use crate::collab::live::payloads::{AccountChangedPayload, RolePayload, TypedAs};
use crate::collab::live::session::guard;

pub(crate) struct AppOverleafPort {
    mirror: Arc<Mirror>,
}

impl AppOverleafPort {
    pub(crate) fn new(mirror: Arc<Mirror>) -> AppOverleafPort {
        AppOverleafPort { mirror }
    }

    fn keep(&self, doc: &DocId, text: &str) {
        let path = guard(&self.mirror.disk.disk)
            .layout
            .get(&doc.0)
            .map(|placed| placed.path.clone());
        let Some(path) = path else {
            return;
        };
        match self.mirror.disk.keep_copy(&path, text, None) {
            Ok(copy) => guard(&self.mirror.kept).push(KeptFile {
                id: doc.0.clone(),
                path,
                copy,
                kind: KeptKind::Beside,
                by: None,
            }),
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live editing could not keep unsent text of {path} in project {}: {error}",
                    self.mirror.disk.project_id
                ));
            }
        }
    }
}

pub(super) fn online_error(error: &OnlineError) -> CollabError {
    let (status, code) = match error.kind {
        OnlineErrorKind::SignedOut | OnlineErrorKind::SessionExpired => (401, "signed_out"),
        OnlineErrorKind::ProjectUnavailable => (403, "access_ended"),
        OnlineErrorKind::RateLimited => (429, "rate_limited"),
        OnlineErrorKind::Unreachable => (503, "unreachable"),
        _ => (500, "failed"),
    };
    CollabError::Api {
        status,
        code: code.to_owned(),
        message: error.to_string(),
    }
}

fn project_role(role: Role) -> ProjectRole {
    match role {
        Role::Owner => ProjectRole::Owner,
        Role::Editor => ProjectRole::Editor,
        Role::Reviewer => ProjectRole::Reviewer,
        Role::Viewer => ProjectRole::Viewer,
    }
}

fn end_reason(end: &LiveEnd) -> EndReason {
    match end {
        LiveEnd::SignedOut => EndReason::SignedOut,
        LiveEnd::AccessEnded => EndReason::AccessEnded,
        LiveEnd::ProjectGone => EndReason::Removed,
        LiveEnd::Stopped => EndReason::Stopped,
        LiveEnd::Unsupported(_) | LiveEnd::Failed(_) => EndReason::Failed,
    }
}

pub(super) fn status_of(state: &LiveState) -> (LiveStatus, u64) {
    match state {
        LiveState::Connecting => (LiveStatus::Connecting, 0),
        LiveState::Online { pending } => (LiveStatus::Online, *pending),
        LiveState::Offline { retry_in, pending } => (
            LiveStatus::Offline {
                retry_in_ms: u64::try_from(retry_in.as_millis()).unwrap_or(u64::MAX),
            },
            *pending,
        ),
        LiveState::SignedOut { pending } => (LiveStatus::SignedOut, *pending),
        LiveState::Idle => (LiveStatus::Idle, 0),
        LiveState::Ended(end) => (
            LiveStatus::Ended {
                reason: end_reason(end),
            },
            0,
        ),
    }
}

pub(super) fn announce_role(mirror: &Mirror, role: ProjectRole, tracking: bool) {
    mirror.disk.host.role(RolePayload {
        project_id: mirror.disk.project_id.clone(),
        role,
        tracking,
        restricted: false,
    });
}

impl LivePort for AppOverleafPort {
    fn state(&self, state: LiveState) {
        let (status, pending) = status_of(&state);
        self.mirror.set_status(status, pending);
    }

    fn role(&self, role: Role, tracking: bool) {
        let role = project_role(role);
        *guard(&self.mirror.role) = Some((role, tracking));
        announce_role(&self.mirror, role, tracking);
    }

    fn texts_changed(&self, docs: Vec<DocId>) {
        self.mirror.mark(docs.into_iter().map(|doc| doc.0), false);
    }

    fn tree_changed(&self, changes: Vec<PathChange>) {
        if !changes.is_empty() {
            self.mirror.mark(std::iter::empty(), true);
        }
    }

    fn peer(&self, _peer: PeerPosition) {}

    fn peer_left(&self, _id: &PublicId) {}

    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason) {
        let sink = guard(&self.mirror.sinks).remove(doc);
        if let Some(sink) = sink {
            sink(DocMessage::Detached {
                reason: stop_reason(&reason),
            });
        }
    }

    fn project_event(&self, _event: ProjectEvent) {}

    fn merged(&self, doc: &DocId, review: MergeReview) {
        match review {
            MergeReview::Kept { text } => self.keep(doc, &text),
            MergeReview::Merged { .. } | MergeReview::NeedsReview { .. } => {}
        }
    }

    fn account_changed(&self, typed_as: Account) {
        let files = std::mem::take(&mut *guard(&self.mirror.kept))
            .into_iter()
            .map(|file| KeptFile {
                by: Some(typed_as.email.clone()),
                ..file
            })
            .collect();
        self.mirror
            .disk
            .host
            .account_changed(AccountChangedPayload {
                project_id: self.mirror.disk.project_id.clone(),
                typed_as: TypedAs {
                    user_id: typed_as.user_id,
                    email: typed_as.email,
                },
                files,
            });
    }

    fn journal_failed(&self, reason: Option<String>) {
        if let Some(reason) = reason {
            let _ = crate::project::append_app_log(format!(
                "Live editing could not save unsent changes of project {}: {reason}; it tries again",
                self.mirror.disk.project_id
            ));
        }
    }

    fn disk_text(&self, path: &str) -> Option<String> {
        self.mirror.mirrored_text(path)
    }
}

fn stop_reason(reason: &DocStopReason) -> String {
    match reason {
        DocStopReason::Unsupported(_) => "unsupported".to_owned(),
        DocStopReason::TooLarge => "too_large".to_owned(),
        DocStopReason::Removed => "removed".to_owned(),
        DocStopReason::Server(_) => "server".to_owned(),
    }
}
