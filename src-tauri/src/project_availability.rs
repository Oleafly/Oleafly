use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::mpsc::Receiver;
use std::sync::{Arc, Mutex, OnceLock, PoisonError};
use std::time::{Duration, Instant};

pub(crate) const LINKED_PROBE_BUDGET: Duration = Duration::from_millis(1_500);
const MAX_PROBED_PROJECTS: usize = 256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectAvailability {
    Unknown,
    Ok,
    Missing,
    Offline,
    Replaced,
    PermissionDenied,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectLocationInfo {
    Library,
    Linked {
        display_path: String,
        availability: ProjectAvailability,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProjectAvailabilityReport {
    pub project_id: String,
    pub availability: ProjectAvailability,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AvailabilityEvent {
    pub project_id: String,
    pub availability: ProjectAvailability,
    pub location_generation: u64,
    pub relocated: bool,
    pub grants_reset: bool,
}

pub type AvailabilitySink = Box<dyn Fn(AvailabilityEvent) + Send + Sync>;

#[derive(Default)]
struct AvailabilityTracker {
    states: Mutex<HashMap<String, (ProjectAvailability, u64)>>,
}

impl AvailabilityTracker {
    fn generation(&self, project_id: &str) -> u64 {
        self.states
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .get(project_id)
            .map_or(0, |&(_, generation)| generation)
    }

    fn observe(
        &self,
        project_id: &str,
        seen_generation: u64,
        availability: ProjectAvailability,
    ) -> Option<AvailabilityEvent> {
        let mut states = self.states.lock().unwrap_or_else(PoisonError::into_inner);
        let (previous, generation) = match states.get(project_id) {
            Some(&(previous, generation)) => (previous, generation),
            None if availability == ProjectAvailability::Ok => return None,
            None => (ProjectAvailability::Ok, 0),
        };
        if generation != seen_generation || previous == availability {
            return None;
        }
        states.insert(project_id.to_string(), (availability, generation));
        Some(AvailabilityEvent {
            project_id: project_id.to_string(),
            availability,
            location_generation: generation,
            relocated: false,
            grants_reset: false,
        })
    }

    fn relocated(&self, project_id: &str, grants_reset: bool) -> AvailabilityEvent {
        let mut states = self.states.lock().unwrap_or_else(PoisonError::into_inner);
        let generation = states
            .get(project_id)
            .map_or(0, |&(_, generation)| generation)
            .wrapping_add(1);
        states.insert(
            project_id.to_string(),
            (ProjectAvailability::Ok, generation),
        );
        AvailabilityEvent {
            project_id: project_id.to_string(),
            availability: ProjectAvailability::Ok,
            location_generation: generation,
            relocated: true,
            grants_reset,
        }
    }
}

fn tracker() -> &'static AvailabilityTracker {
    static TRACKER: OnceLock<AvailabilityTracker> = OnceLock::new();
    TRACKER.get_or_init(AvailabilityTracker::default)
}

fn sink() -> &'static OnceLock<AvailabilitySink> {
    static SINK: OnceLock<AvailabilitySink> = OnceLock::new();
    &SINK
}

fn emit(event: AvailabilityEvent) {
    if let Some(sink) = sink().get() {
        sink(event);
    }
}

pub(crate) fn install_sink(installed: AvailabilitySink) {
    let _ = sink().set(installed);
}

fn session_availability(
    result: &Result<crate::project_location::ProjectLocation, crate::project_location::LocateError>,
) -> Option<ProjectAvailability> {
    use crate::project_location::LocateError;
    match result {
        Ok(_) => Some(ProjectAvailability::Ok),
        Err(LocateError::Unavailable { .. }) => Some(ProjectAvailability::Missing),
        Err(LocateError::Replaced { .. }) => Some(ProjectAvailability::Replaced),
        Err(LocateError::PermissionDenied { .. }) => Some(ProjectAvailability::PermissionDenied),
        Err(LocateError::NotFound(_) | LocateError::Invalid(_)) => None,
    }
}

pub(crate) fn location_generation(project_id: &str) -> u64 {
    tracker().generation(project_id)
}

pub(crate) fn observe_location(
    project_id: &str,
    seen_generation: u64,
    result: &Result<crate::project_location::ProjectLocation, crate::project_location::LocateError>,
) {
    if let Some(event) = session_availability(result)
        .and_then(|state| tracker().observe(project_id, seen_generation, state))
    {
        emit(event);
    }
}

pub(crate) fn relocated(project_id: &str, grants_reset: bool) {
    emit(tracker().relocated(project_id, grants_reset));
}

type Probe = Arc<dyn Fn(&str) -> ProjectAvailability + Send + Sync>;

pub(crate) fn abbreviated_display_path(path: &Path, home: Option<&Path>) -> String {
    let shown = without_verbatim_prefix(path);
    let home = home.map(without_verbatim_prefix);
    if let Some(rest) = home.and_then(|home| shown.strip_prefix(home).ok()) {
        let mut out = String::from("~");
        for component in rest.components() {
            if let Component::Normal(part) = component {
                out.push(std::path::MAIN_SEPARATOR);
                out.push_str(&part.to_string_lossy());
            }
        }
        return out;
    }
    shown.to_string_lossy().into_owned()
}

pub(crate) fn without_verbatim_prefix(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path.to_path_buf()
}

pub(crate) fn display_home() -> Option<PathBuf> {
    let home = crate::paths::home_dir().ok()?;
    Some(home.canonicalize().unwrap_or(home))
}

fn availability_of(
    result: &Result<crate::project_location::ProjectLocation, crate::project_location::LocateError>,
) -> ProjectAvailability {
    use crate::project_location::LocateError;
    match result {
        Ok(_) => ProjectAvailability::Ok,
        Err(
            LocateError::Unavailable { .. } | LocateError::NotFound(_) | LocateError::Invalid(_),
        ) => ProjectAvailability::Missing,
        Err(LocateError::Replaced { .. }) => ProjectAvailability::Replaced,
        Err(LocateError::PermissionDenied { .. }) => ProjectAvailability::PermissionDenied,
    }
}

fn in_flight() -> &'static Mutex<HashSet<String>> {
    static IN_FLIGHT: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    IN_FLIGHT.get_or_init(Default::default)
}

fn start_probe(project_id: &str, probe: Probe) -> Option<Receiver<ProjectAvailability>> {
    if !in_flight()
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(project_id.to_string())
    {
        return None;
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    let id = project_id.to_string();
    let spawned = std::thread::Builder::new()
        .name("oleafly-folder-probe".into())
        .spawn(move || {
            let availability = probe(&id);
            in_flight()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .remove(&id);
            let _ = sender.send(availability);
        });
    if spawned.is_err() {
        in_flight()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(project_id);
        return None;
    }
    Some(receiver)
}

fn probe_all(
    project_ids: Vec<String>,
    budget: Duration,
    probe: Probe,
) -> Vec<ProjectAvailabilityReport> {
    let deadline = Instant::now() + budget;
    let started: Vec<_> = project_ids
        .into_iter()
        .map(|project_id| {
            let receiver = start_probe(&project_id, Arc::clone(&probe));
            (project_id, receiver)
        })
        .collect();
    started
        .into_iter()
        .map(|(project_id, receiver)| ProjectAvailabilityReport {
            availability: receiver.map_or(ProjectAvailability::Unknown, |receiver| {
                receiver
                    .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                    .unwrap_or(ProjectAvailability::Offline)
            }),
            project_id,
        })
        .collect()
}

pub(crate) fn probe_linked_projects(
    project_ids: Vec<String>,
    budget: Duration,
) -> Vec<ProjectAvailabilityReport> {
    probe_all(
        project_ids,
        budget,
        Arc::new(|project_id: &str| availability_of(&crate::project_location::locate(project_id))),
    )
}

fn probe_blocking(
    project_ids: Vec<String>,
    budget: Duration,
) -> Result<Vec<ProjectAvailabilityReport>, String> {
    let mut linked = Vec::new();
    for project_id in project_ids.into_iter().take(MAX_PROBED_PROJECTS) {
        crate::paths::validate_project_id(&project_id)?;
        if crate::project_location::kind_of(&project_id)?
            == crate::project_location::ProjectKind::Linked
        {
            linked.push(project_id);
        }
    }
    Ok(probe_linked_projects(linked, budget))
}

#[tauri::command]
pub async fn probe_project_availability(
    project_ids: Vec<String>,
) -> Result<Vec<ProjectAvailabilityReport>, String> {
    tauri::async_runtime::spawn_blocking(move || probe_blocking(project_ids, LINKED_PROBE_BUDGET))
        .await
        .map_err(|error| format!("failed to check project folders: {error}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn location_serializes_as_a_tagged_object() {
        assert_eq!(
            serde_json::to_value(ProjectLocationInfo::Library).unwrap(),
            serde_json::json!({ "kind": "library" })
        );
        assert_eq!(
            serde_json::to_value(ProjectLocationInfo::Linked {
                display_path: "~/thesis".into(),
                availability: ProjectAvailability::PermissionDenied,
            })
            .unwrap(),
            serde_json::json!({
                "kind": "linked",
                "display_path": "~/thesis",
                "availability": "permission_denied"
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn display_paths_abbreviate_the_home_directory() {
        let home = Path::new("/Users/ada");
        assert_eq!(
            abbreviated_display_path(Path::new("/Users/ada/Desktop/thesis"), Some(home)),
            "~/Desktop/thesis"
        );
        assert_eq!(abbreviated_display_path(home, Some(home)), "~");
        assert_eq!(
            abbreviated_display_path(Path::new("/Volumes/USB/paper"), Some(home)),
            "/Volumes/USB/paper"
        );
        assert_eq!(
            abbreviated_display_path(Path::new("/Users/adam/paper"), Some(home)),
            "/Users/adam/paper"
        );
    }

    #[cfg(windows)]
    #[test]
    fn display_paths_drop_the_verbatim_prefix_on_both_sides() {
        let home = Path::new(r"\\?\C:\Users\ada");
        assert_eq!(
            abbreviated_display_path(Path::new(r"\\?\C:\Users\ada\Desktop\thesis"), Some(home)),
            r"~\Desktop\thesis"
        );
        assert_eq!(
            abbreviated_display_path(Path::new(r"C:\Users\ada\thesis"), Some(home)),
            r"~\thesis"
        );
        assert_eq!(
            abbreviated_display_path(Path::new(r"\\?\UNC\server\share\paper"), Some(home)),
            r"\\server\share\paper"
        );
    }

    #[test]
    fn a_hung_probe_reports_offline_and_a_second_ask_meanwhile_is_not_a_verdict() {
        let started = Instant::now();
        let slow: Probe = Arc::new(|_| {
            std::thread::sleep(Duration::from_secs(2));
            ProjectAvailability::Ok
        });
        let id = "linked-ffffffffffffffffffffffffffffff01".to_string();
        let first = probe_all(
            vec![id.clone()],
            Duration::from_millis(100),
            Arc::clone(&slow),
        );
        let second = probe_all(vec![id.clone()], Duration::from_secs(5), slow);
        assert_eq!(first[0].availability, ProjectAvailability::Offline);
        assert_eq!(second[0].availability, ProjectAvailability::Unknown);
        assert!(started.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn probes_report_present_and_missing_linked_folders_and_skip_library_ids() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        std::fs::create_dir(&data).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        crate::paths::create_project_dir("paper").unwrap();
        let present = directory.path().join("present");
        let gone = directory.path().join("gone");
        std::fs::create_dir(&present).unwrap();
        std::fs::create_dir(&gone).unwrap();
        let present = crate::linked_registry::register_folder_for_test(&present);
        let gone_link = crate::linked_registry::register_folder_for_test(&gone);
        std::fs::remove_dir(&gone).unwrap();

        let reports = probe_blocking(
            vec!["paper".into(), present.id.clone(), gone_link.id.clone()],
            Duration::from_secs(5),
        )
        .unwrap();

        assert_eq!(
            reports,
            vec![
                ProjectAvailabilityReport {
                    project_id: present.id.clone(),
                    availability: ProjectAvailability::Ok,
                },
                ProjectAvailabilityReport {
                    project_id: gone_link.id.clone(),
                    availability: ProjectAvailability::Missing,
                },
            ]
        );
        assert!(probe_blocking(vec!["../x".into()], Duration::from_secs(1)).is_err());
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    fn recorded() -> &'static Mutex<Vec<AvailabilityEvent>> {
        static RECORDED: OnceLock<Mutex<Vec<AvailabilityEvent>>> = OnceLock::new();
        RECORDED.get_or_init(Default::default)
    }

    fn record_events() {
        install_sink(Box::new(|event| {
            recorded()
                .lock()
                .unwrap_or_else(PoisonError::into_inner)
                .push(event);
        }));
    }

    fn events_for(project_id: &str) -> Vec<AvailabilityEvent> {
        recorded()
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .iter()
            .filter(|event| event.project_id == project_id)
            .cloned()
            .collect()
    }

    fn seen(
        tracker: &AvailabilityTracker,
        project_id: &str,
        availability: ProjectAvailability,
    ) -> Option<AvailabilityEvent> {
        tracker.observe(project_id, tracker.generation(project_id), availability)
    }

    #[test]
    fn only_changes_in_availability_are_reported() {
        let tracker = AvailabilityTracker::default();
        assert_eq!(seen(&tracker, "linked-a", ProjectAvailability::Ok), None);
        assert_eq!(
            seen(&tracker, "linked-a", ProjectAvailability::Missing),
            Some(AvailabilityEvent {
                project_id: "linked-a".into(),
                availability: ProjectAvailability::Missing,
                location_generation: 0,
                relocated: false,
                grants_reset: false,
            })
        );
        assert_eq!(
            seen(&tracker, "linked-a", ProjectAvailability::Missing),
            None
        );
        assert_eq!(
            seen(&tracker, "linked-a", ProjectAvailability::Ok)
                .unwrap()
                .availability,
            ProjectAvailability::Ok
        );
        assert_eq!(
            seen(&tracker, "linked-b", ProjectAvailability::Replaced)
                .unwrap()
                .project_id,
            "linked-b"
        );
    }

    #[test]
    fn relocation_bumps_the_generation_and_reports_the_folder_back() {
        let tracker = AvailabilityTracker::default();
        seen(&tracker, "linked-a", ProjectAvailability::Missing);
        let moved = tracker.relocated("linked-a", false);
        assert_eq!(
            (
                moved.availability,
                moved.location_generation,
                moved.relocated,
                moved.grants_reset
            ),
            (ProjectAvailability::Ok, 1, true, false)
        );
        let replaced = tracker.relocated("linked-a", true);
        assert_eq!(
            (replaced.location_generation, replaced.grants_reset),
            (2, true)
        );
        assert_eq!(seen(&tracker, "linked-a", ProjectAvailability::Ok), None);
        assert_eq!(
            seen(&tracker, "linked-a", ProjectAvailability::PermissionDenied)
                .unwrap()
                .location_generation,
            2
        );
    }

    #[test]
    fn a_check_that_began_before_a_relocation_cannot_report_the_old_folder() {
        let tracker = AvailabilityTracker::default();
        tracker.observe("linked-a", 0, ProjectAvailability::Missing);
        let began = tracker.generation("linked-a");
        tracker.relocated("linked-a", false);
        assert_eq!(
            tracker.observe("linked-a", began, ProjectAvailability::Missing),
            None
        );
        let now = tracker.generation("linked-a");
        assert_eq!(
            tracker
                .observe("linked-a", now, ProjectAvailability::Missing)
                .map(|event| (event.availability, event.location_generation)),
            Some((ProjectAvailability::Missing, 1))
        );
    }

    #[test]
    fn events_match_the_webview_contract() {
        let value = serde_json::to_value(AvailabilityEvent {
            project_id: "linked-a".into(),
            availability: ProjectAvailability::PermissionDenied,
            location_generation: 3,
            relocated: true,
            grants_reset: true,
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "projectId": "linked-a",
                "availability": "permission_denied",
                "locationGeneration": 3,
                "relocated": true,
                "grantsReset": true
            })
        );
    }

    #[test]
    fn locating_a_linked_folder_reports_each_change_once_and_ignores_library_projects() {
        let _env_guard = crate::paths::data_dir_env_lock();
        record_events();
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        std::fs::create_dir(&data).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &data);
        let folder = directory.path().join("thesis");
        let away = directory.path().join("elsewhere");
        std::fs::create_dir(&folder).unwrap();
        let record = crate::linked_registry::register_folder_for_test(&folder);
        let library = crate::paths::create_project_dir("paper").unwrap();

        crate::project_location::locate(&record.id).unwrap();
        crate::project_location::locate(&record.id).unwrap();
        std::fs::rename(&folder, &away).unwrap();
        assert!(crate::project_location::locate(&record.id).is_err());
        assert!(crate::project_location::locate(&record.id).is_err());
        std::fs::rename(&away, &folder).unwrap();
        crate::project_location::locate(&record.id).unwrap();
        std::fs::remove_dir(&library).unwrap();
        assert!(crate::project_location::locate("paper").is_err());

        assert_eq!(
            events_for(&record.id)
                .iter()
                .map(|event| event.availability)
                .collect::<Vec<_>>(),
            vec![ProjectAvailability::Missing, ProjectAvailability::Ok]
        );
        assert!(events_for("paper").is_empty());

        relocated(&record.id, true);
        assert_eq!(
            events_for(&record.id).last(),
            Some(&AvailabilityEvent {
                project_id: record.id.clone(),
                availability: ProjectAvailability::Ok,
                location_generation: 1,
                relocated: true,
                grants_reset: true,
            })
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
