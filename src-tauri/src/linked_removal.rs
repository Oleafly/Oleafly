use crate::app_error::AppError;
use crate::linked_registry::{LinkEntry, Membership, Retirement};
use std::collections::HashSet;
use std::io::Read as _;
use std::path::{Path, PathBuf};

pub(crate) const REMOVED_RETENTION_MS: u64 = 30 * 24 * 60 * 60 * 1000;
pub(crate) const PURGE_VERSION: u8 = 1;
const PURGE_QUEUE: &str = "linked-purge-pending";
const PURGE_SUFFIX: &str = ".json";
const MAX_JOB_BYTES: u64 = 4 * 1024;
const LINKED_BUILD_OUTPUT: [&str; 3] = ["build", "figbuild", "builds"];

#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct PurgeOutcome {
    pub(crate) purged: Vec<String>,
    pub(crate) failures: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub(crate) struct PendingPurge {
    pub(crate) version: u8,
    pub(crate) project_id: String,
    pub(crate) removed_at: u64,
}

fn not_removable() -> String {
    AppError::new("project.not_removable").into()
}

pub(crate) fn remove_folder_project(project_id: &str, now_ms: u64) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    let state_dir = match crate::linked_registry::refreshed_membership(project_id)? {
        Membership::Active(member) => member.state_dir,
        Membership::Corrupt(detail) => {
            return Err(AppError::new("project.linked_invalid")
                .detail(detail)
                .into())
        }
        Membership::Absent => return Err(not_removable()),
    };
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(project_id)?;
    let data_root = crate::paths::oleafly_root()?;
    crate::project_grants::reset_project_grants(&data_root, project_id)?;
    crate::linked_registry::update(project_id, |record| {
        if !record.is_active() {
            return Err(not_removable());
        }
        record.removed_at = Some(now_ms);
        record.reattach = None;
        Ok(())
    })?;
    remove_build_output(project_id, &state_dir);
    Ok(())
}

fn remove_build_output(project_id: &str, state_dir: &Path) {
    for name in LINKED_BUILD_OUTPUT {
        let removed = crate::paths::linked_state_directory(state_dir, Path::new(name), false)
            .and_then(|found| match found {
                Some(directory) => std::fs::remove_dir_all(&directory)
                    .map_err(|error| format!("could not delete {name}: {error}")),
                None => Ok(()),
            });
        if let Err(error) = removed {
            let _ = crate::project::append_app_log(format!(
                "Could not delete the build output of removed folder {project_id}: {error}"
            ));
        }
    }
}

fn queue_root(create: bool) -> Result<Option<PathBuf>, String> {
    let data = match crate::paths::oleafly_root()?.canonicalize() {
        Ok(data) => data,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => return Ok(None),
        Err(error) => return Err(format!("failed to resolve Oleafly data directory: {error}")),
    };
    let root = data.join(PURGE_QUEUE);
    match std::fs::symlink_metadata(&root) {
        Ok(metadata)
            if metadata.is_dir()
                && !metadata.file_type().is_symlink()
                && !crate::paths::is_reparse_point(&metadata) =>
        {
            Ok(Some(root))
        }
        Ok(_) => Err("the folder cleanup queue is not a real directory".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            match std::fs::create_dir(&root) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(error) => {
                    return Err(format!(
                        "failed to create the folder cleanup queue: {error}"
                    ))
                }
            }
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt as _;
                let _ = std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700));
            }
            crate::storage::sync_directory(&data)?;
            Ok(Some(root))
        }
        Err(error) => Err(format!(
            "failed to inspect the folder cleanup queue: {error}"
        )),
    }
}

fn job_path(root: &Path, project_id: &str) -> Result<PathBuf, String> {
    crate::paths::validate_project_id(project_id)?;
    if !crate::linked_registry::is_linked_id(project_id) {
        return Err("folder cleanup jobs name opened folders only".into());
    }
    Ok(root.join(format!("{project_id}{PURGE_SUFFIX}")))
}

pub(crate) fn publish_job(job: &PendingPurge) -> Result<PathBuf, String> {
    let root =
        queue_root(true)?.ok_or_else(|| "the folder cleanup queue is unavailable".to_string())?;
    let path = job_path(&root, &job.project_id)?;
    let bytes = serde_json::to_vec(job)
        .map_err(|error| format!("could not encode a folder cleanup job: {error}"))?;
    crate::sandbox::atomic_write(&path, &bytes)?;
    crate::fsperm::harden_file(&path);
    crate::storage::sync_directory(&root)?;
    Ok(path)
}

fn read_job(path: &Path) -> Result<PendingPurge, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("could not inspect a folder cleanup job: {error}"))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("a folder cleanup job is not a regular file".into());
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_JOB_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|error| format!("could not read a folder cleanup job: {error}"))?;
    if bytes.len() as u64 > MAX_JOB_BYTES {
        return Err("a folder cleanup job is too large".into());
    }
    let job: PendingPurge = serde_json::from_slice(&bytes)
        .map_err(|error| format!("a folder cleanup job is unreadable: {error}"))?;
    let expected = path
        .file_name()
        .and_then(std::ffi::OsStr::to_str)
        .and_then(|name| name.strip_suffix(PURGE_SUFFIX));
    if job.version != PURGE_VERSION || expected != Some(job.project_id.as_str()) {
        return Err("a folder cleanup job does not match its file".into());
    }
    Ok(job)
}

fn pending_jobs(failures: &mut Vec<String>) -> Result<Vec<(PathBuf, PendingPurge)>, String> {
    let Some(root) = queue_root(false)? else {
        return Ok(Vec::new());
    };
    let mut jobs = Vec::new();
    for entry in std::fs::read_dir(&root)
        .map_err(|error| format!("could not read the folder cleanup queue: {error}"))?
        .flatten()
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') || !name.ends_with(PURGE_SUFFIX) {
            continue;
        }
        match read_job(&entry.path()) {
            Ok(job) => jobs.push((entry.path(), job)),
            Err(error) => failures.push(format!("{name}: {error}")),
        }
    }
    jobs.sort_by(|left, right| left.1.project_id.cmp(&right.1.project_id));
    Ok(jobs)
}

fn clear_job(path: &Path) -> Result<(), String> {
    match std::fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(format!("could not clear a folder cleanup job: {error}")),
    }
    match path.parent() {
        Some(parent) => crate::storage::sync_directory(parent),
        None => Ok(()),
    }
}

fn purge_project_data(project_id: &str) -> Result<(), String> {
    let data_root = crate::paths::oleafly_root()?;
    crate::project_grants::reset_project_grants(&data_root, project_id)?;
    crate::checkpoints::remove_project_checkpoint_data(project_id)?;
    crate::agent_turns::remove_project(project_id);
    crate::chats::remove_project_chats(project_id)?;
    if data_root.join("library.db").is_file() {
        crate::library_db::index_project_chats(&data_root, project_id, "[]")?;
    }
    Ok(())
}

fn finish_job(path: &Path, job: &PendingPurge) -> Result<bool, String> {
    let _worktree = crate::worktree_lock::ProjectWorktreeLock::exclusive(&job.project_id)?;
    if crate::linked_registry::retire_removed(&job.project_id, job.removed_at)? == Retirement::Kept
    {
        clear_job(path)?;
        return Ok(false);
    }
    purge_project_data(&job.project_id)?;
    crate::linked_registry::discard_retired(&job.project_id)?;
    clear_job(path)?;
    Ok(true)
}

pub(crate) fn purge_expired_removals(now_ms: u64) -> Result<PurgeOutcome, String> {
    let mut outcome = PurgeOutcome::default();
    let mut jobs = pending_jobs(&mut outcome.failures)?;
    let queued: HashSet<String> = jobs.iter().map(|(_, job)| job.project_id.clone()).collect();
    for entry in crate::linked_registry::list()? {
        let LinkEntry::Record(record) = entry else {
            continue;
        };
        let Some(removed_at) = record.removed_at else {
            continue;
        };
        if queued.contains(&record.id) || now_ms.saturating_sub(removed_at) < REMOVED_RETENTION_MS {
            continue;
        }
        let job = PendingPurge {
            version: PURGE_VERSION,
            project_id: record.id.clone(),
            removed_at,
        };
        match publish_job(&job) {
            Ok(path) => jobs.push((path, job)),
            Err(error) => outcome.failures.push(format!("{}: {error}", record.id)),
        }
    }
    for (path, job) in jobs {
        match finish_job(&path, &job) {
            Ok(true) => outcome.purged.push(job.project_id),
            Ok(false) => {}
            Err(error) => outcome
                .failures
                .push(format!("{}: {error}", job.project_id)),
        }
    }
    outcome.purged.sort();
    Ok(outcome)
}

pub(crate) fn purge_expired_removals_at_startup() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    match purge_expired_removals(now) {
        Ok(outcome) => {
            if !outcome.purged.is_empty() {
                let _ = crate::project::append_app_log(format!(
                    "Cleared the kept history of {} folders removed from Oleafly more than 30 days ago",
                    outcome.purged.len()
                ));
            }
            for failure in outcome.failures {
                let _ = crate::project::append_app_log(format!(
                    "Could not clear the kept history of a removed folder: {failure}"
                ));
            }
        }
        Err(error) => {
            let _ = crate::project::append_app_log(format!(
                "Could not check removed folders for history to clear: {error}"
            ));
        }
    }
}

#[tauri::command]
pub async fn remove_linked_project(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<(), String> {
    use tauri::Manager as _;
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    let id = project_id.clone();
    tauri::async_runtime::spawn_blocking(move || remove_folder_project(&id, now))
        .await
        .map_err(|error| format!("failed to remove the folder from Oleafly: {error}"))??;
    if let Some(acp) = app.try_state::<std::sync::Arc<crate::acp::AcpRuntime>>() {
        acp.close_project_sessions(&project_id).await;
    }
    crate::terminal::kill_project_sessions(&project_id);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approvals::ApprovalMode;
    use crate::linked_registry::folder_snapshot_for_test;
    use crate::open_folder::FolderOutcome;
    use crate::trust::testing::LinkedFixture;
    use crate::trust::TrustScope;
    use std::path::{Path, PathBuf};

    const DAY_MS: u64 = 24 * 60 * 60 * 1000;
    const BUILD_OUTPUT: [&str; 3] = ["build", "figbuild", "builds"];

    struct Seeded {
        project_id: String,
        folder: PathBuf,
        state: PathBuf,
        chats: PathBuf,
        checkpoints: PathBuf,
    }

    fn seeded(fixture: &LinkedFixture, name: &str) -> Seeded {
        let (project_id, folder) = fixture.link(name);
        std::fs::write(folder.join("main.tex"), "\\documentclass{article}").unwrap();
        std::fs::create_dir_all(folder.join("chapters")).unwrap();
        std::fs::write(folder.join("chapters").join("intro.tex"), "Intro").unwrap();
        let root = crate::paths::oleafly_root().unwrap();
        let state = crate::project_location::linked_state_dir(&project_id)
            .unwrap()
            .unwrap();
        for name in BUILD_OUTPUT {
            std::fs::create_dir_all(state.join(name)).unwrap();
            std::fs::write(state.join(name).join("output.bin"), b"build").unwrap();
        }
        std::fs::write(
            state.join("project.json"),
            br##"{"name":"Thesis","main_doc":"main.tex","color":"#224466"}"##,
        )
        .unwrap();
        let chats = root.join("chats").join(format!("{project_id}.json"));
        std::fs::create_dir_all(chats.parent().unwrap()).unwrap();
        std::fs::write(&chats, br#"[{"id":"chat-1","title":"Plan"}]"#).unwrap();
        let checkpoints = crate::paths::checkpoint_store_dir(&project_id).unwrap();
        oleafly_history::Store::open(&checkpoints).unwrap();
        Seeded {
            project_id,
            folder,
            state,
            chats,
            checkpoints,
        }
    }

    fn listed(project_id: &str) -> bool {
        crate::project::list_projects_blocking()
            .unwrap()
            .iter()
            .any(|project| project.id == project_id)
    }

    fn queue_is_empty() -> bool {
        let queue = crate::paths::oleafly_root()
            .unwrap()
            .join("linked-purge-pending");
        std::fs::read_dir(queue).map_or(true, |mut entries| entries.next().is_none())
    }

    fn linked_entry(project_id: &str) -> PathBuf {
        crate::paths::existing_linked_root()
            .unwrap()
            .unwrap()
            .join(project_id)
    }

    fn only_entries(directory: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(directory)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    #[test]
    fn removing_a_folder_keeps_its_files_drops_builds_and_trust_and_reopening_restores_chats() {
        let fixture = LinkedFixture::new();
        let seeded = seeded(&fixture, "thesis");
        let root = crate::paths::oleafly_root().unwrap();
        fixture.trust(&seeded.project_id, TrustScope::Folder);
        crate::approvals::set_mode(&root, &seeded.project_id, ApprovalMode::FullAccess).unwrap();
        assert!(crate::trust::is_trusted(&seeded.project_id));
        let before = folder_snapshot_for_test(&seeded.folder);
        let chats = std::fs::read(&seeded.chats).unwrap();

        remove_folder_project(&seeded.project_id, 1_000).unwrap();

        assert_eq!(folder_snapshot_for_test(&seeded.folder), before);
        for name in BUILD_OUTPUT {
            assert!(!seeded.state.join(name).exists(), "{name}");
        }
        assert_eq!(only_entries(&seeded.state), ["link.json", "project.json"]);
        assert!(!crate::trust::is_trusted(&seeded.project_id));
        assert_ne!(
            crate::approvals::policy_for(&root, &seeded.project_id, "write_file")
                .unwrap()
                .0,
            ApprovalMode::FullAccess
        );
        assert!(!listed(&seeded.project_id));
        assert_eq!(std::fs::read(&seeded.chats).unwrap(), chats);
        assert!(seeded.checkpoints.exists());

        let reopened = crate::open_folder::register_or_resolve_folder(&seeded.folder).unwrap();

        assert_eq!(reopened.project_id, seeded.project_id);
        assert!(matches!(reopened.outcome, FolderOutcome::Revived { .. }));
        assert!(listed(&seeded.project_id));
        assert!(!crate::trust::is_trusted(&seeded.project_id));
        assert_eq!(std::fs::read(&seeded.chats).unwrap(), chats);
        assert!(seeded.checkpoints.exists());
        assert_eq!(
            crate::project::read_meta(&seeded.project_id).unwrap().color,
            "#224466"
        );
        assert_eq!(folder_snapshot_for_test(&seeded.folder), before);
    }

    #[test]
    fn only_folders_can_be_removed_and_only_once() {
        let fixture = LinkedFixture::new();
        let seeded = seeded(&fixture, "paper");
        crate::paths::create_project_dir("library-paper").unwrap();

        let library = remove_folder_project("library-paper", 1).unwrap_err();
        remove_folder_project(&seeded.project_id, 1).unwrap();
        let twice = remove_folder_project(&seeded.project_id, 2).unwrap_err();

        assert!(library.contains("project.not_removable"), "{library}");
        assert!(twice.contains("project.not_removable"), "{twice}");
        assert!(remove_folder_project("../escape", 1).is_err());
        assert!(crate::paths::projects_root()
            .unwrap()
            .join("library-paper")
            .is_dir());
    }

    #[test]
    fn the_startup_job_purges_a_removed_folder_only_after_thirty_days() {
        let fixture = LinkedFixture::new();
        let seeded = seeded(&fixture, "thesis");
        let kept = seeded_kept(&fixture);
        let turns = crate::paths::oleafly_root()
            .unwrap()
            .join("agent-turns")
            .join(&seeded.project_id);
        let turn = crate::agent_turns::begin(&seeded.project_id, "Test agent");
        assert!(turn.snapshot_id.is_some(), "{turn:?}");
        let before = folder_snapshot_for_test(&seeded.folder);
        remove_folder_project(&seeded.project_id, 1_000).unwrap();

        let early = purge_expired_removals(1_000 + 29 * DAY_MS).unwrap();

        assert_eq!(early, PurgeOutcome::default());
        assert!(seeded.chats.exists() && seeded.checkpoints.exists());
        assert!(turns.is_dir());
        assert!(linked_entry(&seeded.project_id).exists());

        let due = purge_expired_removals(1_000 + REMOVED_RETENTION_MS).unwrap();

        assert_eq!(due.purged, vec![seeded.project_id.clone()]);
        assert!(due.failures.is_empty(), "{:?}", due.failures);
        assert!(!seeded.chats.exists());
        assert!(!seeded.checkpoints.exists());
        assert!(!turns.exists());
        assert!(!linked_entry(&seeded.project_id).exists());
        assert_eq!(
            only_entries(&crate::paths::existing_linked_root().unwrap().unwrap()),
            std::slice::from_ref(&kept)
        );
        assert!(queue_is_empty());
        assert_eq!(folder_snapshot_for_test(&seeded.folder), before);
        assert!(listed(&kept));
        assert_eq!(
            purge_expired_removals(1_000 + 2 * REMOVED_RETENTION_MS).unwrap(),
            PurgeOutcome::default()
        );

        let reopened = crate::open_folder::register_or_resolve_folder(&seeded.folder).unwrap();
        assert_ne!(reopened.project_id, seeded.project_id);
        assert!(matches!(reopened.outcome, FolderOutcome::New));
    }

    fn seeded_kept(fixture: &LinkedFixture) -> String {
        let (kept, folder) = fixture.link("kept");
        std::fs::write(folder.join("main.tex"), "\\documentclass{article}").unwrap();
        kept
    }

    #[test]
    fn an_interrupted_purge_finishes_on_the_next_start() {
        let fixture = LinkedFixture::new();
        let seeded = seeded(&fixture, "thesis");
        remove_folder_project(&seeded.project_id, 1_000).unwrap();
        let job = PendingPurge {
            version: PURGE_VERSION,
            project_id: seeded.project_id.clone(),
            removed_at: 1_000,
        };
        publish_job(&job).unwrap();
        assert_eq!(
            crate::linked_registry::retire_removed(&seeded.project_id, 1_000).unwrap(),
            crate::linked_registry::Retirement::Retired
        );
        assert!(!linked_entry(&seeded.project_id).exists());
        assert!(seeded.chats.exists());

        let resumed = purge_expired_removals(1_001).unwrap();

        assert_eq!(resumed.purged, vec![seeded.project_id.clone()]);
        assert!(!seeded.chats.exists());
        assert!(!seeded.checkpoints.exists());
        assert!(queue_is_empty());
        assert_eq!(
            only_entries(&crate::paths::existing_linked_root().unwrap().unwrap()),
            Vec::<String>::new()
        );
    }

    #[test]
    fn a_folder_reopened_before_its_purge_runs_keeps_everything() {
        let fixture = LinkedFixture::new();
        let seeded = seeded(&fixture, "thesis");
        remove_folder_project(&seeded.project_id, 1_000).unwrap();
        publish_job(&PendingPurge {
            version: PURGE_VERSION,
            project_id: seeded.project_id.clone(),
            removed_at: 1_000,
        })
        .unwrap();
        crate::open_folder::register_or_resolve_folder(&seeded.folder).unwrap();
        remove_folder_project(&seeded.project_id, 5 * DAY_MS).unwrap();

        let outcome = purge_expired_removals(1_000 + REMOVED_RETENTION_MS).unwrap();

        assert_eq!(outcome, PurgeOutcome::default());
        assert!(seeded.chats.exists() && seeded.checkpoints.exists());
        assert!(linked_entry(&seeded.project_id).join("link.json").exists());
        assert!(queue_is_empty());
    }
}
