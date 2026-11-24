use std::path::Path;
use std::sync::{Arc, Mutex, Weak};
use std::time::{Duration, Instant};

use tokio::task::AbortHandle;

use super::notices::{OverleafNotice, OverleafNoticePayload};
use super::{off_runtime, Mirror, OverleafLive};
use crate::live::downloads::FigureHost;
use crate::live::session::guard;

pub const OPENING: &str = "opening.json";
const PLACED_WAIT: Duration = Duration::from_secs(30);
const FIGURES_WAIT: Duration = Duration::from_secs(10 * 60);

pub fn mark(mirror_dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(mirror_dir)?;
    oleafly_core::atomic::write_atomic_private(&mirror_dir.join(OPENING), b"{}")
}

pub fn marked(mirror_dir: &Path) -> bool {
    mirror_dir.join(OPENING).is_file()
}

fn clear(mirror_dir: &Path) -> std::io::Result<()> {
    oleafly_core::atomic::retry_tree_operation(|| {
        match std::fs::remove_file(mirror_dir.join(OPENING)) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        }
    })
}

#[derive(Default)]
pub struct Opening(Mutex<Option<AbortHandle>>);

impl Opening {
    pub fn close(&self) {
        if let Some(task) = guard(&self.0).take() {
            task.abort();
        }
    }
}

impl Drop for Opening {
    fn drop(&mut self) {
        self.close();
    }
}

fn tell(mirror: &Mirror, notice: OverleafNotice) {
    mirror.disk.host.overleaf_notice(OverleafNoticePayload {
        project_id: mirror.disk.project_id.clone(),
        notice,
    });
}

pub fn filling(mirror: &Arc<Mirror>, done: usize, total: usize) {
    tell(mirror, OverleafNotice::Filling { done, total });
    if done < total {
        return;
    }
    let task = mirror.disk.spawn(settle(Arc::downgrade(mirror)));
    if let Some(previous) = guard(&mirror.opening.0).replace(task.abort_handle()) {
        previous.abort();
    }
}

async fn placed(mirror: &Weak<Mirror>) -> Option<Arc<OverleafLive>> {
    let started = Instant::now();
    loop {
        let live = mirror.upgrade()?.live.get().and_then(Weak::upgrade);
        if let Some(live) = live.filter(|live| !live.ended()) {
            return Some(live);
        }
        if started.elapsed() >= PLACED_WAIT {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

async fn settle(mirror: Weak<Mirror>) {
    let Some(live) = placed(&mirror).await else {
        if let Some(mirror) = mirror.upgrade() {
            mirror.disk.log_once("opening", || {
                "could not finish opening the project from Overleaf, so it carries on at the next start"
                    .to_owned()
            });
        }
        return;
    };
    live.flush().await;
    live.wait_for_figures(FIGURES_WAIT).await;
    let dir = live.hold_dir();
    match off_runtime(move || clear(&dir)).await {
        Ok(Ok(())) => tell(&live.mirror, OverleafNotice::Filled),
        Ok(Err(error)) => live.mirror.disk.log_once("opening", || {
            format!("could not mark the project as opened from Overleaf: {error}")
        }),
        Err(error) => live.mirror.disk.log_once("opening", || {
            format!("could not mark the project as opened from Overleaf: {error}")
        }),
    }
}
