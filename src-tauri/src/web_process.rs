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

    #[cfg(any(target_os = "macos", test))]
    fn has_room(&mut self, now: Instant) -> bool {
        self.0
            .retain(|at| now.saturating_duration_since(*at) < RELOAD_WINDOW);
        self.0.len() < MAX_RELOADS
    }
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowLocation {
    pub project_id: String,
    pub path: Option<String>,
}

#[derive(Default)]
pub struct RestoreAfterReload {
    noted: Mutex<HashMap<String, WindowLocation>>,
    armed: Mutex<HashMap<String, WindowLocation>>,
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
    fn arm(&self, label: &str) {
        let noted = self
            .noted
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(label)
            .cloned();
        if let Some(location) = noted {
            self.armed
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .insert(label.to_owned(), location);
        }
    }

    fn take(&self, label: &str) -> Option<WindowLocation> {
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
) -> Option<WindowLocation> {
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
    fn has_room_looks_without_spending() {
        let start = Instant::now();
        let mut budget = ReloadBudget::default();
        assert!(budget.has_room(start));
        assert!(budget.has_room(start));
        for second in [0, 1, 2] {
            assert!(budget.spend(start + Duration::from_secs(second)));
        }
        assert!(!budget.has_room(start + Duration::from_secs(10)));
        assert!(budget.has_room(start + Duration::from_secs(61)));
    }

    fn location(project: &str, path: Option<&str>) -> WindowLocation {
        WindowLocation {
            project_id: project.to_owned(),
            path: path.map(str::to_owned),
        }
    }

    #[test]
    fn restores_only_after_the_watchdog_arms_it_and_only_once() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", Some("main.tex"))));
        assert_eq!(restore.take("main"), None);
        restore.arm("main");
        assert_eq!(restore.take("main"), Some(location("p1", Some("main.tex"))));
        assert_eq!(restore.take("main"), None);
    }

    #[test]
    fn restores_the_latest_location_of_the_window_that_was_reloaded() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", None)));
        restore.note("main", Some(location("p2", Some("chapters/intro.tex"))));
        restore.note("preview", Some(location("p3", None)));
        restore.arm("main");
        assert_eq!(restore.take("preview"), None);
        assert_eq!(
            restore.take("main"),
            Some(location("p2", Some("chapters/intro.tex")))
        );
    }

    #[test]
    fn a_closed_project_leaves_nothing_to_restore() {
        let restore = RestoreAfterReload::default();
        restore.note("main", Some(location("p1", Some("main.tex"))));
        restore.note("main", None);
        restore.arm("main");
        assert_eq!(restore.take("main"), None);
    }
}
