use std::sync::Arc;
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::materialize::Placed;
use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::error::{OnlineError, OnlineErrorKind};
use oleafly_online::live::doc::DocFault;
use oleafly_online::live::session::{
    Account, DocStopReason, LiveEnd, LivePeer, LivePort, LiveState, MergeReview,
};
use oleafly_online::live::tree_queue::{LocalFile, QueueState, Queued, TreeChange, TreeFailure};
use oleafly_online::realtime::events::{ProjectEvent, PublicId};
use oleafly_online::realtime::project::{flavor_for_compiler, Role};
use oleafly_online::realtime::tree::{NodeKind as OverleafKind, PathChange};
use oleafly_online::realtime::DocId;
use oleafly_ot::DocMessage;

use super::notices::{OverleafNotice, OverleafNoticePayload};
use super::Mirror;
use crate::collab::disk::{safe_target, sha256_hex};
use crate::collab::live::kept::{KeptFile, KeptKind, KeptPayload};
use crate::collab::live::payloads::{
    AccountChangedPayload, DocPendingPayload, OverleafMembersPayload, PresenceLeftPayload,
    PresencePayload, PresencePerson, RolePayload, TypedAs,
};
use crate::collab::live::session::guard;
use crate::collab::live::uploads::{UploadFile, UploadState, UploadsPayload};
use crate::collab::settings::Applied;

pub(crate) struct AppOverleafPort {
    mirror: Arc<Mirror>,
}

impl AppOverleafPort {
    pub(crate) fn new(mirror: Arc<Mirror>) -> AppOverleafPort {
        AppOverleafPort { mirror }
    }

    fn follow(
        &self,
        main_doc: Option<&str>,
        flavor: Option<&str>,
    ) -> Result<Option<crate::project::ProjectMeta>, String> {
        let root = self.mirror.disk.root.clone();
        crate::project::follow_shared_settings(&self.mirror.disk.project_id, |meta| {
            let flavor = flavor
                .map(str::to_owned)
                .or_else(|| meta.tex_flavor.clone());
            let changed =
                crate::project::adopt_online_settings(&root, meta, main_doc, flavor.as_deref());
            Ok(((), changed))
        })
        .map(|(_, meta)| meta)
    }

    fn notice(&self, notice: OverleafNotice) {
        self.mirror
            .disk
            .host
            .overleaf_notice(OverleafNoticePayload {
                project_id: self.mirror.disk.project_id.clone(),
                notice,
            });
    }

    fn notice_for(&self, doc: &DocId, notice: impl FnOnce(String) -> OverleafNotice) {
        if let Some(path) = self.mirror.path_of(doc) {
            self.notice(notice(path));
        }
    }

    fn kept_in_file(&self, doc: &DocId) {
        if let Some(path) = self.mirror.path_of(doc) {
            guard(&self.mirror.kept).push(KeptFile {
                id: doc.0.clone(),
                path,
                copy: None,
                kind: KeptKind::Unsent,
                by: None,
            });
        }
    }

    fn keep(&self, doc: &DocId, text: &str) {
        let Some(path) = self.mirror.path_of(doc) else {
            return;
        };
        match self.mirror.disk.keep_copy(&path, text, None) {
            Ok(copy) => guard(&self.mirror.kept).push(KeptFile {
                id: doc.0.clone(),
                path,
                copy: Some(copy),
                kind: KeptKind::Unsent,
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

    fn place_early_moves(&self, changes: &[PathChange]) {
        let mut adopted = guard(&self.mirror.adopted);
        if adopted.is_empty() {
            return;
        }
        let mut disk = guard(&self.mirror.disk.disk);
        for change in changes {
            let PathChange::Moved {
                id,
                from,
                kind: OverleafKind::Doc,
                ..
            } = change
            else {
                continue;
            };
            if disk.layout.contains_key(&id.0) || !adopted.remove(from) {
                continue;
            }
            disk.layout.insert(
                id.0.clone(),
                Placed {
                    path: from.clone(),
                    kind: NodeKind::Text,
                    blob: None,
                },
            );
        }
    }

    fn announce_kept(&self) {
        let files = {
            let mut kept = guard(&self.mirror.kept);
            let removing = guard(&self.mirror.removing);
            let (held, files): (Vec<KeptFile>, Vec<KeptFile>) = std::mem::take(&mut *kept)
                .into_iter()
                .partition(|file| removing.contains(&file.id));
            *kept = held;
            files
        };
        if !files.is_empty() {
            self.mirror.disk.host.kept(KeptPayload {
                project_id: self.mirror.disk.project_id.clone(),
                files,
            });
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

pub(super) fn project_role(role: Role) -> ProjectRole {
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
        LiveEnd::Removed => EndReason::Removed,
        LiveEnd::ProjectGone => EndReason::ProjectDeleted,
        LiveEnd::Stopped => EndReason::Stopped,
        LiveEnd::Unsupported(_) => EndReason::ClientTooOld,
        LiveEnd::Failed(_) => EndReason::Failed,
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
    let (restricted, deleted_externally) = *guard(&mirror.flags);
    mirror.disk.host.role(RolePayload {
        project_id: mirror.disk.project_id.clone(),
        role,
        tracking,
        restricted,
        deleted_externally,
    });
}

impl LivePort for AppOverleafPort {
    fn state(&self, state: LiveState) {
        self.announce_kept();
        let (status, pending) = status_of(&state);
        self.mirror.set_status(status, pending);
    }

    fn role(&self, role: Role, tracking: bool) {
        self.announce_kept();
        let role = project_role(role);
        *guard(&self.mirror.role) = Some((role, tracking));
        announce_role(&self.mirror, role, tracking);
    }

    fn project_flags(&self, restricted: bool, deleted_externally: bool) {
        *guard(&self.mirror.flags) = (restricted, deleted_externally);
        let known = *guard(&self.mirror.role);
        if let Some((role, tracking)) = known {
            announce_role(&self.mirror, role, tracking);
        }
    }

    fn texts_changed(&self, docs: Vec<DocId>) {
        self.mirror.mark(docs.into_iter().map(|doc| doc.0), false);
    }

    fn tree_changed(&self, changes: Vec<PathChange>) {
        if changes.is_empty() {
            return;
        }
        let replaced: Vec<DocId> = changes
            .iter()
            .filter_map(|change| match change {
                PathChange::Replaced { old, .. } => Some(DocId(old.0.clone())),
                _ => None,
            })
            .collect();
        guard(&self.mirror.removing).retain(|id| !replaced.iter().any(|old| old.0 == *id));
        guard(&self.mirror.replaced).extend(replaced);
        self.place_early_moves(&changes);
        self.mirror.mark(std::iter::empty(), true);
    }

    fn peer(&self, peer: LivePeer) {
        let path = peer.doc.as_ref().and_then(|doc| self.mirror.path_of(doc));
        self.mirror.disk.host.presence(PresencePayload {
            project_id: self.mirror.disk.project_id.clone(),
            device_id: peer.id.0,
            account_id: peer.user_id.unwrap_or_default(),
            cursor: path
                .as_ref()
                .and(peer.offset)
                .and_then(|offset| u32::try_from(offset).ok()),
            path,
            anchor: None,
            person: Some(PresencePerson {
                name: peer.name,
                email: peer.email,
            }),
            activity: None,
        });
    }

    fn peer_left(&self, id: &PublicId) {
        self.mirror.disk.host.presence_left(PresenceLeftPayload {
            project_id: self.mirror.disk.project_id.clone(),
            device_id: id.0.clone(),
        });
    }

    fn members_changed(&self) {
        self.mirror
            .disk
            .host
            .overleaf_members(OverleafMembersPayload {
                project_id: self.mirror.disk.project_id.clone(),
            });
    }

    fn doc_stopped(&self, doc: &DocId, reason: DocStopReason) {
        let replaced = guard(&self.mirror.replaced).remove(doc);
        let removed = matches!(reason, DocStopReason::Removed);
        let deleted = removed && !replaced;
        if deleted && guard(&self.mirror.kept).iter().any(|file| file.id == doc.0) {
            guard(&self.mirror.removing).insert(doc.0.clone());
        }
        let reason = match reason {
            DocStopReason::Removed if replaced => "replaced".to_owned(),
            other => stop_reason(&other),
        };
        let sink = guard(&self.mirror.sinks).remove(doc);
        if let Some(sink) = sink {
            sink(DocMessage::Detached {
                reason: reason.clone(),
            });
        }
        if !removed {
            self.notice_for(doc, |path| OverleafNotice::Fault { path, reason });
        }
        if !deleted {
            self.announce_kept();
        }
    }

    fn project_event(&self, event: ProjectEvent) {
        let project_id = self.mirror.disk.project_id.clone();
        let followed = match event {
            ProjectEvent::Name(name) => {
                crate::project::rename_project_blocking(project_id.clone(), name).map(Some)
            }
            ProjectEvent::RootDoc(doc) => match self.mirror.path_of(&doc) {
                Some(path) => self.follow(Some(&path), None),
                None => Ok(None),
            },
            ProjectEvent::Compiler(compiler) => match flavor_for_compiler(&compiler) {
                Some(flavor) => self.follow(None, Some(flavor)),
                None => {
                    let _ = crate::project::append_app_log(format!(
                        "Overleaf switched project {project_id} to the {compiler} compiler, which Oleafly doesn't run; the project keeps its engine"
                    ));
                    Ok(None)
                }
            },
            ProjectEvent::Image(_)
            | ProjectEvent::SpellLanguage(_)
            | ProjectEvent::MainBibliography(_)
            | ProjectEvent::DeletedOrRenamedExternally => Ok(None),
        };
        match followed {
            Ok(Some(meta)) => self.mirror.disk.host.settings_changed(Applied {
                project_id,
                meta: Some(meta),
                notices: Vec::new(),
                pushed: false,
            }),
            Ok(None) => {}
            Err(error) => {
                let _ = crate::project::append_app_log(format!(
                    "Live editing could not follow a project setting from Overleaf for project {project_id}: {error}"
                ));
            }
        }
    }

    fn merged(&self, doc: &DocId, review: MergeReview) {
        match review {
            MergeReview::Kept { text } => self.keep(doc, &text),
            MergeReview::InFile => self.kept_in_file(doc),
            MergeReview::Merged { before, after } => {
                self.notice_for(doc, |path| OverleafNotice::Merged {
                    path,
                    before,
                    after,
                })
            }
            MergeReview::NeedsReview { mine, theirs } => self.notice_for(doc, |path| {
                OverleafNotice::NeedsReview { path, mine, theirs }
            }),
        }
    }

    fn maintenance(&self, message: &str, delay: Duration) {
        self.notice(OverleafNotice::Maintenance {
            message: message.to_owned(),
            delay_ms: u64::try_from(delay.as_millis()).unwrap_or(u64::MAX),
        });
    }

    fn slow_ack(&self, waiting: bool) {
        self.notice(OverleafNotice::SlowAck { waiting });
    }

    fn doc_unsteady(&self, doc: &DocId) {
        self.notice_for(doc, |path| OverleafNotice::Unsteady { path });
    }

    fn external_update(&self, doc: &DocId) {
        self.notice_for(doc, |path| OverleafNotice::External { path });
    }

    fn characters_replaced(&self, doc: &DocId) {
        self.notice_for(doc, |path| OverleafNotice::Replaced { path });
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

    fn local_file(&self, path: &str) -> Option<LocalFile> {
        let target = safe_target(&self.mirror.disk.root, path)?;
        let bytes = std::fs::read(target).ok()?;
        Some(LocalFile {
            tag: sha256_hex(&bytes),
            bytes,
        })
    }

    fn never_online(&self, path: &str) -> bool {
        oleafly_online::sync::never_online(&self.mirror.disk.root, path)
    }

    fn tree_queue(&self, changes: Vec<Queued>) {
        self.mirror.disk.host.uploads(UploadsPayload {
            project_id: self.mirror.disk.project_id.clone(),
            files: changes.iter().filter_map(upload_row).collect(),
        });
    }

    fn uploaded(&self, _path: &str, tag: &str, hash: Option<&str>) {
        if let Some(hash) = hash {
            self.mirror.learn_blob(hash, tag);
        }
    }

    fn adopt_file_text(&self, path: &str) -> Option<String> {
        self.mirror.adopt_file_text(path)
    }

    fn doc_pending(&self, doc: &DocId, pending: bool) {
        let Some(path) = self.mirror.path_of(doc) else {
            return;
        };
        self.mirror.disk.host.doc_pending(DocPendingPayload {
            project_id: self.mirror.disk.project_id.clone(),
            path,
            pending,
        });
    }
}

pub(super) fn upload_row(queued: &Queued) -> Option<UploadFile> {
    let state = match &queued.state {
        QueueState::Waiting => match queued.change {
            TreeChange::NewDoc { .. } | TreeChange::Upload { .. } => UploadState::Waiting,
            _ => return None,
        },
        QueueState::Failed {
            failure: TreeFailure::TooLarge,
        } => UploadState::TooLarge,
        QueueState::Failed { .. } => UploadState::Failed,
    };
    Some(UploadFile {
        path: queued.change.path().to_owned(),
        state,
        size: 0,
        limit: None,
    })
}

fn stop_reason(reason: &DocStopReason) -> String {
    let name = match reason {
        DocStopReason::Removed => "removed",
        DocStopReason::Fault(fault) => match fault {
            DocFault::DeleteMismatch => "delete_mismatch",
            DocFault::BadHash => "bad_hash",
            DocFault::TooLong => "too_long",
            DocFault::TooLarge => "too_large",
            DocFault::TooManyRanges => "too_many_ranges",
            DocFault::TypeMismatch => "type_mismatch",
            DocFault::Unavailable => "unavailable",
            DocFault::Unsupported(_) => "unsupported",
            DocFault::Refused(_) => "refused",
        },
    };
    name.to_owned()
}
