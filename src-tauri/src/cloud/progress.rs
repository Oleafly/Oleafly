use oleafly_core::ids::ProjectId;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

pub(crate) const EVENT: &str = "cloud-progress";
const EVERY: Duration = Duration::from_millis(150);

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Phase {
    Uploading,
    Downloading,
    Fetching,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    pub(crate) project_id: Option<String>,
    pub(crate) cloud_id: String,
    pub(crate) phase: Phase,
    pub(crate) done: u64,
    pub(crate) total: u64,
}

pub(crate) type ProgressSink = Box<dyn Fn(Progress) + Send + Sync>;

fn sink() -> &'static OnceLock<ProgressSink> {
    static SINK: OnceLock<ProgressSink> = OnceLock::new();
    &SINK
}

pub(crate) fn install_sink(installed: ProgressSink) {
    let _ = sink().set(installed);
}

pub(crate) struct Meter {
    project_id: Option<String>,
    cloud: ProjectId,
    phase: Phase,
    total: u64,
    done: AtomicU64,
    last: Mutex<Option<Instant>>,
}

impl Meter {
    pub(crate) fn start(
        project_id: Option<&str>,
        cloud: ProjectId,
        phase: Phase,
        total: u64,
    ) -> Self {
        let meter = Self {
            project_id: project_id.map(str::to_string),
            cloud,
            phase,
            total,
            done: AtomicU64::new(0),
            last: Mutex::new(None),
        };
        meter.emit(0);
        meter
    }

    pub(crate) fn add(&self, count: u64) {
        let done = self.done.fetch_add(count, Ordering::Relaxed) + count;
        let now = Instant::now();
        let due = {
            let mut last = self.last.lock().unwrap_or_else(PoisonError::into_inner);
            let due = done >= self.total || last.is_none_or(|at| now.duration_since(at) >= EVERY);
            if due {
                *last = Some(now);
            }
            due
        };
        if due {
            self.emit(done.min(self.total));
        }
    }

    fn emit(&self, done: u64) {
        if let Some(sink) = sink().get() {
            sink(Progress {
                project_id: self.project_id.clone(),
                cloud_id: self.cloud.to_string(),
                phase: self.phase,
                done,
                total: self.total,
            });
        }
    }
}

#[cfg(test)]
pub(crate) mod recorded {
    use super::{install_sink, Progress};
    use std::sync::{Mutex, PoisonError};

    static EVENTS: Mutex<Vec<Progress>> = Mutex::new(Vec::new());

    pub(crate) fn listen() {
        install_sink(Box::new(|event| {
            EVENTS
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(event);
        }));
    }

    pub(crate) fn for_cloud(cloud_id: &str) -> Vec<Progress> {
        EVENTS
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .filter(|event| event.cloud_id == cloud_id)
            .cloned()
            .collect()
    }
}
