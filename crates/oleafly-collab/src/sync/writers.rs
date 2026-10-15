use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use oleafly_collab_protocol::snapshots::ProjectPeer;
use tokio::sync::mpsc::UnboundedSender;
use tokio::task::JoinHandle;

use super::{lock, LiveEvent, LiveLink, SharedLive};
use crate::live::LiveProject;

const WRITERS_RETRY_MS: [u64; 6] = [500, 1_000, 2_000, 5_000, 10_000, 30_000];

pub(super) async fn listed_peers(link: &LiveLink) -> Option<Vec<ProjectPeer>> {
    let access = link
        .sessions
        .access_token(link.server_id, &link.client)
        .await
        .ok()?;
    link.client.project_peers(&access, link.project).await.ok()
}

pub(super) fn admit_writers(live: &mut LiveProject, writers: Option<Vec<ProjectPeer>>) -> bool {
    match writers {
        Some(listed) => {
            live.pin_peers(listed);
            false
        }
        None => {
            live.await_writers();
            true
        }
    }
}

#[derive(Default)]
pub(super) struct WriterRetry(Mutex<Option<JoinHandle<()>>>);

impl WriterRetry {
    fn replace(&self, task: JoinHandle<()>) {
        let mut slot = self.0.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(earlier) = slot.replace(task) {
            earlier.abort();
        }
    }
}

impl Drop for WriterRetry {
    fn drop(&mut self) {
        let slot = self.0.get_mut().unwrap_or_else(PoisonError::into_inner);
        if let Some(task) = slot.take() {
            task.abort();
        }
    }
}

pub(super) fn retry_writers(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    retry: &WriterRetry,
) {
    let (link, project, events) = (link.clone(), Arc::clone(project), events.clone());
    retry.replace(tokio::spawn(async move {
        for wait in WRITERS_RETRY_MS {
            tokio::time::sleep(Duration::from_millis(wait)).await;
            let writers = listed_peers(&link).await;
            if !admit_writers(&mut lock(&project), writers) {
                let _ = events.send(LiveEvent::Changed);
                return;
            }
        }
    }));
}

pub(super) async fn seed_peers(
    link: &LiveLink,
    project: &SharedLive,
    events: &UnboundedSender<LiveEvent>,
    retry: &WriterRetry,
) {
    let writers = listed_peers(link).await;
    if admit_writers(&mut lock(project), writers) {
        retry_writers(link, project, events, retry);
    }
}
