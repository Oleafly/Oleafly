use std::sync::{Arc, Mutex};
use std::time::Duration;

use oleafly_collab::doc::NodeKind;
use oleafly_collab::materialize::Placed;
use oleafly_collab::sync::{EndReason, LiveStatus};
use oleafly_collab::CollabError;
use oleafly_collab_protocol::projects::ProjectRole;
use oleafly_online::error::{OnlineError, OnlineErrorKind};
use oleafly_online::live::doc::DocFault;
use oleafly_online::live::session::{
    Account, ChatChange, DocStopReason, LiveEnd, LivePeer, LivePort, LiveState, MergeReview,
    OutsideText, ReviewChange, Seeded,
};
use oleafly_online::live::tree_queue::{LocalFile, QueueState, Queued, TreeChange, TreeFailure};
use oleafly_online::realtime::events::{ProjectEvent, PublicId};
use oleafly_online::realtime::project::Role;
use oleafly_online::realtime::tree::{NodeKind as OverleafKind, PathChange};
use oleafly_online::realtime::DocId;
use oleafly_ot::DocMessage;

use oleafly_core::app_log::AppLog;
use tokio::runtime::Handle;
use tokio::task::JoinHandle;

use super::notices::{OverleafNotice, OverleafNoticePayload};
use super::Mirror;
use crate::disk::{exists_exact, inside, safe_target, sha256_hex};
use crate::live::moves::{RemovedFile, RemovedPayload};
use crate::live::payloads::{
    AccountChangedPayload, DocPendingPayload, KeptFile, KeptKind, KeptPayload,
    OverleafMembersPayload, PresenceLeftPayload, PresencePayload, PresencePerson,
    RemoteEditPayload, RolePayload, TypedAs, UploadFile, UploadState, UploadsPayload,
};
use crate::live::session::{guard, off_runtime};

pub struct MirrorPort {
    mirror: Arc<Mirror>,
}

pub type Waiting = Box<dyn FnOnce(&MirrorPort) + Send>;

pub type Chore = Box<dyn FnOnce() + Send>;

#[derive(Default)]
struct ChoreQueue {
    sender: Option<tokio::sync::mpsc::UnboundedSender<Chore>>,
    worker: Option<JoinHandle<()>>,
    closed: bool,
}

pub struct Chores {
    queue: Mutex<ChoreQueue>,
    runtime: Handle,
    log: AppLog,
}

impl Chores {
    pub fn new(runtime: Handle, log: AppLog) -> Chores {
        Chores {
            queue: Mutex::new(ChoreQueue::default()),
            runtime,
            log,
        }
    }

    pub fn post(&self, chore: Chore) {
        let mut queue = guard(&self.queue);
        if queue.closed {
            drop(queue);
            chore();
            return;
        }
        if queue.sender.is_none() {
            let (sender, chores) = tokio::sync::mpsc::unbounded_channel();
            queue.worker = Some(self.runtime.spawn(do_chores(chores, self.log.clone())));
            queue.sender = Some(sender);
        }
        if let Some(Err(refused)) = queue.sender.as_ref().map(|sender| sender.send(chore)) {
            drop(queue);
            (refused.0)();
        }
    }

    #[cfg(any(test, feature = "test-support"))]
    pub async fn drained(&self) {
        let (done, drained) = tokio::sync::oneshot::channel();
        self.post(Box::new(move || {
            let _ = done.send(());
        }));
        let _ = drained.await;
    }

    pub async fn close(&self, within: Duration) {
        let worker = {
            let mut queue = guard(&self.queue);
            queue.closed = true;
            queue.sender = None;
            queue.worker.take()
        };
        let Some(mut worker) = worker else {
            return;
        };
        if tokio::time::timeout(within, &mut worker).await.is_err() {
            worker.abort();
            let _ = self.log.write(&format!(
                "Live editing stopped waiting for its file work after {} s",
                within.as_secs()
            ));
        }
    }
}

impl Drop for Chores {
    fn drop(&mut self) {
        if let Some(worker) = guard(&self.queue).worker.take() {
            worker.abort();
        }
    }
}

async fn do_chores(mut chores: tokio::sync::mpsc::UnboundedReceiver<Chore>, log: AppLog) {
    while let Some(chore) = chores.recv().await {
        if let Err(error) = off_runtime(chore).await {
            let _ = log.write(&format!(
                "Live editing could not finish a file task: {error}"
            ));
        }
    }
}

impl MirrorPort {
    pub fn new(mirror: Arc<Mirror>) -> MirrorPort {
        MirrorPort { mirror }
    }

    fn chore(&self, work: impl FnOnce(&MirrorPort) + Send + 'static) {
        let port = MirrorPort::new(Arc::clone(&self.mirror));
        self.mirror.chores.post(Box::new(move || work(&port)));
    }

    fn local_target(&self, path: &str) -> Option<std::path::PathBuf> {
        let path = self.mirror.disk_path(path);
        exists_exact(&self.mirror.disk.root, &path)
            .then(|| safe_target(&self.mirror.disk.root, &path))
            .flatten()
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

    fn with_path(&self, doc: &DocId, work: impl FnOnce(&MirrorPort, String) + Send + 'static) {
        self.with_path_else(doc, move |port, path| {
            if let Some(path) = path {
                work(port, path);
            }
        });
    }

    fn with_path_else(
        &self,
        doc: &DocId,
        work: impl FnOnce(&MirrorPort, Option<String>) + Send + 'static,
    ) {
        if let Some(path) = self.mirror.path_of(doc) {
            work(self, Some(path));
            return;
        }
        let doc = doc.clone();
        self.when_started(move |port| {
            let path = port.mirror.path_of(&doc);
            work(port, path);
        });
    }

    fn when_started(&self, work: impl FnOnce(&MirrorPort) + Send + 'static) {
        let mut waiting = guard(&self.mirror.waiting);
        if let Some(queue) = waiting.as_mut() {
            queue.push(Box::new(work));
            return;
        }
        drop(waiting);
        work(self);
    }

    pub fn started(&self) {
        if let Some(session) = self.mirror.session.get().and_then(std::sync::Weak::upgrade) {
            self.mirror.files(&session.nodes());
        }
        let queue = guard(&self.mirror.waiting).take().unwrap_or_default();
        for work in queue {
            work(self);
        }
    }

    fn notice_for(
        &self,
        doc: &DocId,
        notice: impl FnOnce(String) -> OverleafNotice + Send + 'static,
    ) {
        self.with_path(doc, move |port, path| port.notice(notice(path)));
    }

    fn kept_in_file(&self, doc: &DocId) {
        let id = doc.0.clone();
        self.with_path(doc, move |port, path| {
            port.chore(move |port| {
                guard(&port.mirror.kept).push(KeptFile {
                    id,
                    path,
                    copy: None,
                    kind: KeptKind::Unsent,
                    by: None,
                });
            });
        });
    }

    fn keep(&self, doc: &DocId, text: String) {
        let kept = doc.clone();
        self.with_path_else(doc, move |port, path| {
            match path.or_else(|| port.mirror.last_path(&kept)) {
                Some(path) => port.chore(move |port| port.keep_at(kept.0, path, &text)),
                None => port.chore(move |port| {
                    port.mirror.disk.log(format!(
                        "Live editing could not keep {} characters of unsent text of document {} in project {}: the service no longer lists it and it had no known path",
                        text.chars().count(),
                        kept.0,
                        port.mirror.disk.project_id
                    ));
                }),
            }
        });
    }

    fn keep_at(&self, id: String, path: String, text: &str) {
        match self.mirror.disk.keep_copy(&path, text, None) {
            Ok(copy) => guard(&self.mirror.kept).push(KeptFile {
                id,
                path,
                copy: Some(copy),
                kind: KeptKind::Unsent,
                by: None,
            }),
            Err(error) => {
                self.mirror.disk.log(format!(
                    "Live editing could not keep {} characters of unsent text of {path} (document {id}) in project {}: {error}",
                    text.chars().count(),
                    self.mirror.disk.project_id
                ));
            }
        }
    }

    fn removed_with_kept(&self, id: String) {
        if !guard(&self.mirror.kept).iter().any(|file| file.id == id) {
            return;
        }
        let told = guard(&self.mirror.told).remove(&id);
        let gone = !guard(&self.mirror.disk.disk).layout.contains_key(&id);
        match told.filter(|_| gone) {
            Some(file) => self.tell_again_with_copy(file),
            None => {
                guard(&self.mirror.removing).insert(id);
            }
        }
    }

    fn tell_again_with_copy(&self, file: RemovedFile) {
        let copy = {
            let mut kept = guard(&self.mirror.kept);
            let copy = kept
                .iter()
                .find(|kept| inside(&kept.path, &file.path))
                .and_then(|kept| kept.copy.clone());
            kept.retain(|kept| !inside(&kept.path, &file.path));
            copy
        };
        let disk = &self.mirror.disk;
        let layout = guard(&disk.disk).layout.clone();
        disk.tell_removed(
            &layout,
            Some(RemovedPayload {
                project_id: disk.project_id.clone(),
                files: vec![RemovedFile {
                    yours: copy.is_some(),
                    copy,
                    ..file
                }],
                restored: Vec::new(),
            }),
        );
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

    fn typed_as(&self, typed_as: Account) {
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

    fn announce_kept(&self) {
        self.chore(MirrorPort::announce_kept_now);
    }

    fn announce_kept_now(&self) {
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

pub fn online_error(error: &OnlineError) -> CollabError {
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

pub fn project_role(role: Role) -> ProjectRole {
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

pub fn status_of(state: &LiveState) -> (LiveStatus, u64) {
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

pub fn announce_role(mirror: &Mirror, role: ProjectRole, tracking: bool) {
    let (restricted, deleted_externally) = *guard(&mirror.flags);
    mirror.disk.host.role(RolePayload {
        project_id: mirror.disk.project_id.clone(),
        role,
        tracking,
        restricted,
        deleted_externally,
    });
}

impl LivePort for MirrorPort {
    fn state(&self, state: LiveState) {
        if let LiveState::Ended(LiveEnd::Failed(reason)) = &state {
            let reason = reason.clone();
            self.chore(move |port| {
                port.mirror.disk.log_once("ended", || {
                    format!("the session ended with an error: {reason}")
                });
            });
        }
        self.announce_kept();
        let ended = matches!(
            &state,
            LiveState::Ended(end) if !matches!(end, LiveEnd::Stopped | LiveEnd::SignedOut)
        );
        let hooks = self.mirror.hooks();
        if matches!(state, LiveState::Online { .. })
            && hooks.as_ref().is_some_and(|hooks| !hooks.owner_known())
        {
            self.when_started(|port| {
                port.chore(|port| {
                    if let Some(hooks) = port.mirror.hooks() {
                        hooks.record_owner();
                    }
                });
            });
        }
        let (status, pending) = status_of(&state);
        self.mirror.set_status(status, pending);
        if let Some(hooks) = hooks.filter(|_| ended) {
            hooks.ended();
        }
    }

    fn role(&self, role: Role, tracking: bool) {
        self.announce_kept();
        if matches!(role, Role::Owner | Role::Editor) {
            guard(&self.mirror.deletes).refused.clear();
        }
        let role = project_role(role);
        let import_owed = self.mirror.learn_role(role, tracking);
        announce_role(&self.mirror, role, tracking);
        if let Some(hooks) = self.mirror.hooks() {
            hooks.role_known();
        }
        self.mirror.kick();
        if import_owed {
            self.mirror.import_now();
        }
    }

    fn project_flags(&self, restricted: bool, deleted_externally: bool) {
        *guard(&self.mirror.flags) = (restricted, deleted_externally);
        let known = *guard(&self.mirror.role);
        if let Some((role, tracking)) = known {
            announce_role(&self.mirror, role, tracking);
        }
        if let Some(hooks) = self.mirror.hooks() {
            hooks.role_known();
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
        guard(&self.mirror.names).follow(&changes);
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
        if deleted {
            let id = doc.0.clone();
            self.chore(move |port| port.removed_with_kept(id));
        }
        let reason = match reason {
            DocStopReason::Removed if replaced => "replaced".to_owned(),
            other => stop_reason(&other),
        };
        let sink = guard(&self.mirror.sinks).remove(doc);
        if let Some((_, sink)) = sink {
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
        self.chore(move |port| {
            if let Some(hooks) = port.mirror.hooks() {
                hooks.project_event(event);
            }
        });
    }

    fn merged(&self, doc: &DocId, review: MergeReview) {
        match review {
            MergeReview::Kept { text } => self.keep(doc, text),
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
        self.chore(move |port| port.typed_as(typed_as));
    }

    fn journal_failed(&self, reason: Option<String>) {
        if let Some(reason) = reason {
            self.chore(move |port| {
                port.mirror.disk.log(format!(
                    "Live editing could not save unsent changes of project {}: {reason}. It tries again",
                    port.mirror.disk.project_id
                ));
            });
        }
    }

    fn disk_text(&self, path: &str) -> Option<String> {
        self.mirror.mirrored_text(&self.mirror.disk_path(path))
    }

    fn local_file(&self, path: &str) -> Option<LocalFile> {
        let bytes = std::fs::read(self.local_target(path)?).ok()?;
        Some(LocalFile {
            tag: sha256_hex(&bytes),
            bytes,
        })
    }

    fn local_file_size(&self, path: &str) -> Option<u64> {
        std::fs::metadata(self.local_target(path)?)
            .ok()
            .filter(std::fs::Metadata::is_file)
            .map(|metadata| metadata.len())
    }

    fn never_online(&self, path: &str) -> bool {
        oleafly_online::sync::never_online(&self.mirror.disk.root, &self.mirror.disk_path(path))
    }

    fn tree_queue(&self, changes: Vec<Queued>) {
        self.mirror.disk.host.uploads(UploadsPayload {
            project_id: self.mirror.disk.project_id.clone(),
            files: changes
                .iter()
                .filter_map(|queued| upload_row(&self.mirror, queued))
                .collect(),
        });
    }

    fn uploaded(&self, _path: &str, tag: &str, hash: Option<&str>) {
        if let Some(hash) = hash {
            self.mirror.learn_blob(hash, tag);
        }
    }

    fn adopt_file_text(&self, path: &str) -> Option<String> {
        self.mirror.adopt_file_text(&self.mirror.disk_path(path))
    }

    fn outside_text(&self, path: &str) -> Option<OutsideText> {
        self.mirror.outside_text(&self.mirror.disk_path(path))
    }

    fn review_changed(&self, change: ReviewChange) {
        let Some(hooks) = self.mirror.hooks() else {
            return;
        };
        let lines = hooks.review_trouble(&change);
        if !lines.is_empty() {
            self.chore(move |port| {
                for line in lines {
                    port.mirror.disk.log(line);
                }
            });
        }
        self.when_started(move |port| {
            if let Some(hooks) = port.mirror.hooks() {
                hooks.review_changed(change);
            }
        });
    }

    fn chat_changed(&self, change: ChatChange) {
        let Some(hooks) = self.mirror.hooks() else {
            return;
        };
        if let Some(line) = hooks.chat_trouble(&change) {
            self.chore(move |port| port.mirror.disk.log(line));
        }
        self.when_started(move |port| {
            if let Some(hooks) = port.mirror.hooks() {
                hooks.chat_changed(change);
            }
        });
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

    fn remote_edit(&self, doc: &DocId, user_id: Option<&str>) {
        let user_id = user_id.map(str::to_owned);
        self.with_path(doc, move |port, path| {
            port.mirror.disk.host.remote_edit(RemoteEditPayload {
                project_id: port.mirror.disk.project_id.clone(),
                path,
                user_id,
            });
        });
    }

    fn filling(&self, done: usize, total: usize) {
        super::opening::filling(&self.mirror, done, total);
    }

    fn seeded(&self, path: &str, outcome: Seeded) {
        self.mirror.seeded(path, outcome);
    }
}

pub fn upload_row(mirror: &Mirror, queued: &Queued) -> Option<UploadFile> {
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
        path: mirror.disk_path(queued.change.path()),
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

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use oleafly_core::app_log::AppLog;
    use tokio::runtime::Handle;

    use super::Chores;

    #[test]
    fn chores_run_in_order_off_the_caller_and_a_stuck_one_is_given_up_on() {
        let dir = tempfile::tempdir().unwrap();
        let chores_in = || Chores::new(Handle::current(), AppLog::at(dir.path()));
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let chores = chores_in();
            let done = Arc::new(Mutex::new(Vec::new()));
            for n in 0..5 {
                let done = Arc::clone(&done);
                chores.post(Box::new(move || {
                    std::thread::sleep(Duration::from_millis(5 * (5 - n)));
                    done.lock().unwrap().push(n);
                }));
            }
            chores.close(Duration::from_secs(5)).await;
            assert_eq!(*done.lock().unwrap(), vec![0, 1, 2, 3, 4]);

            let stuck = chores_in();
            let (release, released) = std::sync::mpsc::channel::<()>();
            stuck.post(Box::new(move || {
                let _ = released.recv_timeout(Duration::from_secs(10));
            }));
            let started = Instant::now();
            stuck.close(Duration::from_millis(200)).await;
            assert!(started.elapsed() < Duration::from_secs(2));
            drop(release);

            let late = Arc::new(AtomicBool::new(false));
            let ran = Arc::clone(&late);
            stuck.post(Box::new(move || ran.store(true, Ordering::SeqCst)));
            assert!(late.load(Ordering::SeqCst));
        });
    }
}
