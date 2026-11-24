use std::pin::pin;
use std::sync::Arc;
use std::time::Duration;

use super::pacing::JoinPacer;
use super::state::{name_of, parent_of, Finished, Job};
use super::{persist_soon, SessionTuning, Shared};
use crate::live::rest::{ProjectRest, RestError};
use crate::live::tree_queue::{stays_a_file, TreeChange, TreeFailure, MAX_UPLOAD_BYTES};
use crate::realtime::events::{EntityId, TreeEvent};
use crate::session::SessionHandle;

const LONGEST_RETRY: Duration = Duration::from_secs(60);
const SHORTEST_RATE_WAIT: Duration = Duration::from_secs(1);
const LONGEST_RATE_WAIT: Duration = Duration::from_secs(15 * 60);
const STOP_GRACE: Duration = Duration::from_secs(2);
const IDLE_CHECK: Duration = Duration::from_secs(5);
const ALREADY_THERE: &str = "already exists";

enum Outcome {
    Finished(Finished),
    Later(Duration),
}

impl From<Finished> for Outcome {
    fn from(finished: Finished) -> Outcome {
        Outcome::Finished(finished)
    }
}

pub(super) struct TreeWorker {
    shared: Arc<Shared>,
    rest: Arc<ProjectRest>,
    tuning: SessionTuning,
    docs: JoinPacer,
    folders: JoinPacer,
    uploads: JoinPacer,
    failures: u32,
}

fn already_there(error: &RestError) -> bool {
    matches!(error, RestError::Refused { status: 400, message } if message.to_ascii_lowercase().contains(ALREADY_THERE))
}

async fn stopped(shared: &Shared) {
    loop {
        let notified = shared.tree_wake.notified();
        if shared.is_stopping() {
            return;
        }
        notified.await;
    }
}

async fn until_stopped<T>(
    shared: &Shared,
    work: impl std::future::Future<Output = T>,
) -> Option<T> {
    let mut work = pin!(work);
    tokio::select! {
        done = work.as_mut() => return Some(done),
        () = stopped(shared) => {}
    }
    tokio::time::timeout(STOP_GRACE, work).await.ok()
}

impl TreeWorker {
    pub(super) fn new(
        shared: Arc<Shared>,
        rest: Arc<ProjectRest>,
        tuning: SessionTuning,
    ) -> TreeWorker {
        TreeWorker {
            docs: JoinPacer::new(tuning.doc_limit, tuning.create_window),
            folders: JoinPacer::new(tuning.folder_limit, tuning.create_window),
            uploads: JoinPacer::new(tuning.upload_limit, tuning.upload_window),
            shared,
            rest,
            tuning,
            failures: 0,
        }
    }

    fn over(&self) -> bool {
        self.shared.is_stopping() || self.shared.lock().ended.is_some()
    }

    async fn pause(&self, wait: Duration) {
        tokio::select! {
            () = tokio::time::sleep(wait) => {}
            () = self.shared.tree_wake.notified() => {}
        }
    }

    async fn idle(&self) {
        let notified = self.shared.tree_wake.notified();
        let mut notified = pin!(notified);
        notified.as_mut().enable();
        if self.over() || self.shared.lock().next_tree_job().is_some() {
            return;
        }
        tokio::select! {
            () = notified => {}
            () = tokio::time::sleep(IDLE_CHECK) => {}
        }
    }

    async fn hold(&self, wait: Duration) {
        let until = tokio::time::Instant::now() + wait;
        while !self.over() {
            let left = until.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                return;
            }
            self.pause(left.min(self.tuning.tick)).await;
        }
    }

    pub(super) async fn run(mut self) {
        while !self.over() {
            let next = self.shared.lock().next_tree_job();
            let Some(job) = next else {
                self.idle().await;
                continue;
            };
            persist_soon(&self.shared, true).await;
            let session = self.shared.session();
            let shared = Arc::clone(&self.shared);
            let Some(outcome) = until_stopped(&shared, self.perform(&session, &job)).await else {
                return;
            };
            match outcome {
                Outcome::Finished(finished) => {
                    self.failures = 0;
                    self.shared
                        .with(|state| state.finish_tree_job(&job, finished));
                    persist_soon(&self.shared, true).await;
                }
                Outcome::Later(wait) => self.hold(wait).await,
            }
        }
    }

    fn retry_later(&mut self) -> Outcome {
        self.failures = self.failures.saturating_add(1);
        let wait = self
            .tuning
            .tree_retry
            .saturating_mul(1 << self.failures.min(5).saturating_sub(1));
        Outcome::Later(wait.min(LONGEST_RETRY))
    }

    fn judged(&mut self, error: RestError) -> Outcome {
        match error {
            RestError::Refused { message, .. } => {
                Finished::Failed(TreeFailure::Refused(message)).into()
            }
            RestError::NotAllowed => Finished::Failed(TreeFailure::NotAllowed).into(),
            RestError::TooLarge => Finished::Failed(TreeFailure::TooLarge).into(),
            RestError::RateLimited(wait) => Outcome::Later(
                wait.map_or(self.tuning.rate_floor, |wait| wait.max(SHORTEST_RATE_WAIT))
                    .min(LONGEST_RATE_WAIT),
            ),
            RestError::SignedOut
            | RestError::Lost(_)
            | RestError::Unreachable(_)
            | RestError::Unreadable(_)
            | RestError::Short => self.retry_later(),
        }
    }

    fn paced(pacer: &mut JoinPacer) -> Option<Outcome> {
        let now = tokio::time::Instant::now();
        let delay = pacer.delay(now);
        if delay.is_zero() {
            pacer.record(now);
            None
        } else {
            Some(Outcome::Later(delay))
        }
    }

    async fn perform(&mut self, session: &SessionHandle, job: &Job) -> Outcome {
        match &job.change {
            TreeChange::NewFolder { path } => match self.folder(session, Some(path)).await {
                Ok(_) => Finished::Done.into(),
                Err(outcome) => outcome,
            },
            TreeChange::NewDoc { path } => self.new_doc(session, path).await,
            TreeChange::Upload { path } => self.upload(session, path).await,
            TreeChange::Move { to, .. } => match &job.entity {
                Some(entity) => self.relocate(session, entity, to).await,
                None => Finished::Dropped.into(),
            },
            TreeChange::Delete { .. } => match &job.entity {
                Some(entity) => self.delete(session, entity).await,
                None => Finished::Dropped.into(),
            },
        }
    }

    async fn folder(
        &mut self,
        session: &SessionHandle,
        path: Option<&str>,
    ) -> Result<EntityId, Outcome> {
        let root = self
            .shared
            .lock()
            .folder_at(None)
            .ok_or(Outcome::Later(self.tuning.tick))?;
        let Some(path) = path.filter(|path| !path.is_empty()) else {
            return Ok(root);
        };
        let mut parent = root;
        let mut at = String::new();
        for part in path.split('/') {
            if !at.is_empty() {
                at.push('/');
            }
            at.push_str(part);
            if let Some(found) = self.shared.lock().folder_at(Some(&at)) {
                parent = found;
                continue;
            }
            if let Some(wait) = Self::paced(&mut self.folders) {
                return Err(wait);
            }
            match self.rest.create_folder(session, &parent, part).await {
                Ok(id) => {
                    self.shared.with(|state| {
                        state.landed(&TreeEvent::NewFolder {
                            folder: parent.clone(),
                            id: id.clone(),
                            name: part.to_string(),
                        });
                    });
                    parent = id;
                }
                Err(error) if matches!(error, RestError::Lost(_)) || already_there(&error) => {
                    let found = self.shared.lock().folder_at(Some(&at));
                    match found {
                        Some(found) => parent = found,
                        None => return Err(self.retry_later()),
                    }
                }
                Err(error) => return Err(self.judged(error)),
            }
        }
        Ok(parent)
    }

    fn reconciled(&self, path: &str) -> Option<Outcome> {
        self.shared
            .lock()
            .entity_at(path)
            .map(|_| Finished::Done.into())
    }

    async fn listed(&mut self, session: &SessionHandle, path: &str) -> Outcome {
        if let Some(done) = self.reconciled(path) {
            return done;
        }
        match self.rest.entities(session).await {
            Ok(paths) if paths.iter().any(|listed| listed == path) => Finished::Done.into(),
            _ => self.retry_later(),
        }
    }

    async fn read_text(&self, path: &str) -> Option<String> {
        let port = Arc::clone(&self.shared.port);
        let path = path.to_string();
        tokio::task::spawn_blocking(move || port.disk_text(&path))
            .await
            .ok()
            .flatten()
    }

    async fn too_large(&self, path: &str) -> bool {
        let port = Arc::clone(&self.shared.port);
        let path = path.to_string();
        tokio::task::spawn_blocking(move || port.local_file_size(&path))
            .await
            .ok()
            .flatten()
            .is_some_and(|size| size > MAX_UPLOAD_BYTES)
    }

    async fn new_doc(&mut self, session: &SessionHandle, path: &str) -> Outcome {
        if self.too_large(path).await {
            return Finished::Failed(TreeFailure::TooLarge).into();
        }
        let Some(text) = self.read_text(path).await else {
            return Finished::Dropped.into();
        };
        if stays_a_file(&text) {
            return self.upload(session, path).await;
        }
        if self.shared.lock().entity_at(path).is_some() {
            return Finished::Done.into();
        }
        let parent = match self.folder(session, parent_of(path)).await {
            Ok(parent) => parent,
            Err(outcome) => return outcome,
        };
        if let Some(wait) = Self::paced(&mut self.docs) {
            return wait;
        }
        self.shared.with(|state| state.expect_fill(path));
        let name = name_of(path);
        match self.rest.create_doc(session, &parent, name).await {
            Ok(id) => {
                self.shared.with(|state| {
                    state.landed(&TreeEvent::NewDoc {
                        folder: parent,
                        id,
                        name: name.to_string(),
                    });
                });
                Finished::Done.into()
            }
            Err(RestError::Lost(_)) => self.listed(session, path).await,
            Err(error) if already_there(&error) => self.listed(session, path).await,
            Err(error) => self.judged(error),
        }
    }

    async fn upload(&mut self, session: &SessionHandle, path: &str) -> Outcome {
        if self.too_large(path).await {
            return Finished::Failed(TreeFailure::TooLarge).into();
        }
        let port = Arc::clone(&self.shared.port);
        let wanted = path.to_string();
        let Some(file) = tokio::task::spawn_blocking(move || port.local_file(&wanted))
            .await
            .ok()
            .flatten()
        else {
            return Finished::Dropped.into();
        };
        if file.bytes.len() as u64 > MAX_UPLOAD_BYTES {
            return Finished::Failed(TreeFailure::TooLarge).into();
        }
        let existed = self.shared.lock().entity_at(path).is_some();
        let folder = match self.folder(session, parent_of(path)).await {
            Ok(folder) => folder,
            Err(outcome) => return outcome,
        };
        if let Some(wait) = Self::paced(&mut self.uploads) {
            return wait;
        }
        match self
            .rest
            .upload(session, &folder, name_of(path), &file.bytes)
            .await
        {
            Ok(uploaded) => {
                self.shared
                    .with(|state| state.uploaded(path, &folder, uploaded, &file.tag));
                Finished::Done.into()
            }
            Err(RestError::Lost(_)) if !existed => self.listed(session, path).await,
            Err(error) => self.judged(error),
        }
    }

    async fn relocate(&mut self, session: &SessionHandle, entity: &EntityId, to: &str) -> Outcome {
        let placed = self.shared.lock().server_place(entity);
        let Some((kind, server_parent, server_name)) = placed else {
            return Finished::Dropped.into();
        };
        let parent = match self.folder(session, parent_of(to)).await {
            Ok(parent) => parent,
            Err(outcome) => return outcome,
        };
        let name = name_of(to);
        if server_parent.as_ref() != Some(&parent) {
            if let Err(error) = self.rest.move_to(session, kind, entity, &parent).await {
                return self.judged(error);
            }
        }
        if server_name != name {
            if let Err(error) = self.rest.rename(session, kind, entity, name).await {
                return self.judged(error);
            }
        }
        self.shared.with(|state| state.moved(entity, &parent, name));
        Finished::Done.into()
    }

    async fn delete(&mut self, session: &SessionHandle, entity: &EntityId) -> Outcome {
        let placed = self.shared.lock().server_place(entity);
        let Some((kind, _, _)) = placed else {
            return Finished::Done.into();
        };
        let until = tokio::time::Instant::now() + self.tuning.delete_settle;
        loop {
            let settled = self.shared.lock().settled_under(entity);
            if settled || tokio::time::Instant::now() >= until {
                break;
            }
            self.hold(self.tuning.tick).await;
        }
        match self.rest.delete(session, kind, entity).await {
            Ok(()) => {
                self.shared.with(|state| state.deleted(entity));
                Finished::Done.into()
            }
            Err(error) => self.judged(error),
        }
    }
}
