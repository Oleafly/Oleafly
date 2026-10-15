#[cfg(target_os = "linux")]
mod linux_gtk;
#[cfg(target_os = "macos")]
pub(crate) mod macos_wk;
#[cfg(any(target_os = "macos", test))]
mod watchdog;

#[cfg(target_os = "linux")]
pub(crate) use linux_gtk::plugin;
#[cfg(target_os = "macos")]
pub(crate) use macos_wk::{on_web_content_process_terminate, plugin};

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

#[cfg(any(target_os = "linux", target_os = "macos", test))]
use std::time::{Duration, Instant};

#[cfg(any(target_os = "linux", target_os = "macos", test))]
const RELOAD_WINDOW: Duration = Duration::from_secs(60);

#[cfg(any(target_os = "linux", target_os = "macos", test))]
const MAX_RELOADS: usize = 3;

// A watchdog kill needs a loaded page, 10 s before the first probe and 30 s
// without an answer, so kills are at least about 40 s apart. Their own budget
// spans ten minutes, so a page that hangs after every reload runs out of it.
#[cfg(any(target_os = "macos", test))]
const WATCHDOG_KILL_WINDOW: Duration = Duration::from_secs(600);

#[cfg(any(target_os = "macos", test))]
pub(crate) const MAX_WATCHDOG_KILLS: usize = 2;

#[cfg(any(target_os = "linux", target_os = "macos", test))]
#[derive(Default)]
struct ReloadBudget(Vec<Instant>);

#[cfg(any(target_os = "linux", target_os = "macos", test))]
impl ReloadBudget {
    fn spend(&mut self, now: Instant) -> bool {
        self.0
            .retain(|at| now.saturating_duration_since(*at) < RELOAD_WINDOW);
        if self.0.len() >= MAX_RELOADS {
            return false;
        }
        self.0.push(now);
        true
    }
}

/// What a watchdog kill reloads into.
#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum KillPlan {
    /// Reload and reopen the project and files that were open.
    Restore,
    /// The window hung again soon after, maybe because of what it reopened:
    /// reload into the library.
    Library,
    /// Out of kills: leave the window as it is.
    GiveUp,
}

#[cfg(any(target_os = "macos", test))]
#[derive(Default)]
pub(crate) struct KillBudget(Vec<Instant>);

#[cfg(any(target_os = "macos", test))]
impl KillBudget {
    fn recent(&mut self, now: Instant) -> usize {
        self.0
            .retain(|at| now.saturating_duration_since(*at) < WATCHDOG_KILL_WINDOW);
        self.0.len()
    }

    pub(crate) fn has_room(&mut self, now: Instant) -> bool {
        self.recent(now) < MAX_WATCHDOG_KILLS
    }

    pub(crate) fn spend(&mut self, now: Instant) -> KillPlan {
        let recent = self.recent(now);
        if recent >= MAX_WATCHDOG_KILLS {
            return KillPlan::GiveUp;
        }
        self.0.push(now);
        if recent == 0 {
            KillPlan::Restore
        } else {
            KillPlan::Library
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowLocation {
    pub project_id: String,
    pub path: Option<String>,
    #[serde(default)]
    pub open_tabs: Vec<String>,
}

// Only the macOS watchdog arms a restore. Elsewhere the command always
// answers that there is nothing to restore.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReloadReason {
    /// The watchdog reloaded the window because it stopped answering.
    Unresponsive,
    /// It did again soon after, so the window comes back to the library.
    UnresponsiveAgain,
}

/// Why the watchdog reloaded a window, and the work to reopen if any.
#[cfg_attr(not(any(target_os = "macos", test)), allow(dead_code))]
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadRestore {
    pub reason: ReloadReason,
    pub location: Option<WindowLocation>,
}

#[derive(Default)]
pub struct RestoreAfterReload {
    noted: Mutex<HashMap<String, WindowLocation>>,
    armed: Mutex<HashMap<String, ReloadRestore>>,
}

impl RestoreAfterReload {
    fn note(&self, label: &str, location: Option<WindowLocation>) {
        let mut noted = self.noted.lock().unwrap_or_else(PoisonError::into_inner);
        match location {
            Some(location) => noted.insert(label.to_owned(), location),
            None => noted.remove(label),
        };
    }

    #[cfg(any(target_os = "macos", test))]
    fn arm(&self, label: &str, plan: KillPlan) {
        let restore = match plan {
            KillPlan::Restore => ReloadRestore {
                reason: ReloadReason::Unresponsive,
                location: self
                    .noted
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .get(label)
                    .cloned(),
            },
            KillPlan::Library => ReloadRestore {
                reason: ReloadReason::UnresponsiveAgain,
                location: None,
            },
            KillPlan::GiveUp => return,
        };
        self.armed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .insert(label.to_owned(), restore);
    }

    fn take(&self, label: &str) -> Option<ReloadRestore> {
        self.armed
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(label)
    }
}

#[tauri::command]
pub fn web_process_note_location(
    webview: tauri::Webview,
    state: tauri::State<'_, RestoreAfterReload>,
    location: Option<WindowLocation>,
) {
    state.note(webview.label(), location);
}

#[tauri::command]
pub fn web_process_take_restore(
    webview: tauri::Webview,
    state: tauri::State<'_, RestoreAfterReload>,
) -> Option<ReloadRestore> {
    state.take(webview.label())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reloads_a_few_times_a_minute_and_then_stops() {
        let start = Instant::now();
        let mut budget = ReloadBudget::default();
        assert!(budget.spend(start));
        assert!(budget.spend(start + Duration::from_secs(5)));
        assert!(budget.spend(start + Duration::from_secs(10)));
        assert!(!budget.spend(start + Duration::from_secs(20)));
        assert!(!budget.spend(start + Duration::from_secs(59)));
    }

    #[test]
    fn the_budget_refills_as_old_reloads_age_out() {
        let start = Instant::now();
        let mut budget = ReloadBudget::default();
        for second in [0, 1, 2] {
            assert!(budget.spend(start + Duration::from_secs(second)));
        }
        assert!(!budget.spend(start + Duration::from_secs(30)));
        for second in [61, 62, 63] {
            assert!(budget.spend(start + Duration::from_secs(second)));
        }
        assert!(!budget.spend(start + Duration::from_secs(64)));
    }

    #[test]
    fn watchdog_kills_give_up_on_a_page_that_hangs_after_every_reload() {
        let start = Instant::now();
        let mut kills = KillBudget::default();
        assert_eq!(kills.spend(start), KillPlan::Restore);
        assert_eq!(
            kills.spend(start + Duration::from_secs(42)),
            KillPlan::Library
        );
        assert!(!kills.has_room(start + Duration::from_secs(84)));
        assert_eq!(
            kills.spend(start + Duration::from_secs(84)),
            KillPlan::GiveUp
        );
    }

    #[test]
    fn the_kill_budget_refills_after_ten_minutes() {
        let start = Instant::now();
        let mut kills = KillBudget::default();
        assert!(kills.has_room(start));
        assert!(kills.has_room(start));
        assert_eq!(kills.spend(start), KillPlan::Restore);
        assert_eq!(
            kills.spend(start + Duration::from_secs(300)),
            KillPlan::Library
        );
        assert!(!kills.has_room(start + Duration::from_secs(599)));
        assert_eq!(
            kills.spend(start + Duration::from_secs(601)),
            KillPlan::Library
        );
        assert_eq!(
            kills.spend(start + Duration::from_secs(1_202)),
            KillPlan::Restore
        );
    }

    fn location(project: &str, path: Option<&str>) -> WindowLocation {
        WindowLocation {
            project_id: project.to_owned(),
            path: path.map(str::to_owned),
            open_tabs: Vec::new(),
        }
    }

    fn reopen(location: WindowLocation) -> ReloadRestore {
        ReloadRestore {
            reason: ReloadReason::Unresponsive,
            location: Some(location),
        }
    }

    #[test]
    fn restores_only_after_the_watchdog_arms_it_and_only_once() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", Some("main.tex"))));
        assert_eq!(restore.take("main"), None);
        restore.arm("main", KillPlan::Restore);
        assert_eq!(
            restore.take("main"),
            Some(reopen(location("p1", Some("main.tex"))))
        );
        assert_eq!(restore.take("main"), None);
    }

    #[test]
    fn restores_the_latest_location_of_the_window_that_was_reloaded() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", None)));
        let tabs = WindowLocation {
            open_tabs: vec!["main.tex".into(), "chapters/intro.tex".into()],
            ..location("p2", Some("chapters/intro.tex"))
        };
        restore.note("main", Some(tabs.clone()));
        restore.note("preview", Some(location("p3", None)));
        restore.arm("main", KillPlan::Restore);
        assert_eq!(restore.take("preview"), None);
        assert_eq!(restore.take("main"), Some(reopen(tabs)));
    }

    #[test]
    fn a_closed_project_still_explains_the_reload() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", Some("main.tex"))));
        restore.note("main", None);
        restore.arm("main", KillPlan::Restore);
        assert_eq!(
            restore.take("main"),
            Some(ReloadRestore {
                reason: ReloadReason::Unresponsive,
                location: None,
            })
        );
    }

    #[test]
    fn a_second_kill_reloads_into_the_library_without_reopening_the_work() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", Some("figure.pdf"))));
        restore.arm("main", KillPlan::Library);
        assert_eq!(
            restore.take("main"),
            Some(ReloadRestore {
                reason: ReloadReason::UnresponsiveAgain,
                location: None,
            })
        );
        restore.arm("main", KillPlan::GiveUp);
        assert_eq!(restore.take("main"), None);
    }

    #[test]
    fn locations_noted_before_open_tabs_existed_still_parse() {
        let parsed: WindowLocation =
            serde_json::from_str(r#"{"projectId":"p1","path":null}"#).unwrap();
        assert_eq!(parsed, location("p1", None));
        let reason = serde_json::to_value(reopen(location("p1", None))).unwrap();
        assert_eq!(reason["reason"], "unresponsive");
        assert_eq!(reason["location"]["openTabs"], serde_json::json!([]));
    }
}
