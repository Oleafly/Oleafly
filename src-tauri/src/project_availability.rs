use serde::Serialize;
use std::collections::HashSet;
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

fn without_verbatim_prefix(path: &Path) -> PathBuf {
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
            availability: receiver
                .and_then(|receiver| {
                    receiver
                        .recv_timeout(deadline.saturating_duration_since(Instant::now()))
                        .ok()
                })
                .unwrap_or(ProjectAvailability::Offline),
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
    fn a_hung_probe_reports_offline_within_the_budget_and_is_not_restarted() {
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
        assert_eq!(second[0].availability, ProjectAvailability::Offline);
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
}
