use std::time::Instant;

pub(super) use oleafly_live::live::pacing::*;

use super::session::Active;
use super::unwritten::backoff;

impl Active {
    pub(super) fn save_owed(&self) -> bool {
        self.local.paced(|pace| pace.owed)
    }

    pub(super) fn save_due(&self, urgent: bool) -> bool {
        let (due, gap) = self.local.paced(|pace| {
            let gap = if pace.failures == 0 {
                PACE
            } else {
                backoff(pace.failures)
            };
            let due = urgent || pace.saved.is_none_or(|at| at.elapsed() >= gap);
            if due {
                pace.saved = Some(Instant::now());
                pace.owed = false;
                #[cfg(test)]
                {
                    pace.counted.saves += 1;
                }
            } else {
                pace.owed = true;
            }
            (due, gap)
        });
        if !due {
            self.local.come_back_in(gap);
        }
        due
    }

    pub(super) async fn save_document(&self) {
        let saved = self.persist().await;
        let failures = self.local.paced(|pace| {
            if saved.is_ok() {
                pace.failures = 0;
            } else {
                pace.failures = pace.failures.saturating_add(1);
                pace.owed = true;
            }
            pace.failures
        });
        let Err(error) = saved else {
            return;
        };
        if failures == 1 {
            let _ = crate::project::append_app_log(format!(
                "Live collaboration could not save the shared document of project {}: {error}; it tries again",
                self.local.project_id
            ));
        }
        self.local.come_back_in(backoff(failures));
    }
}
