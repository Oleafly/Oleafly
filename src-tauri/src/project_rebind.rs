use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::Serialize;

use crate::app_error::AppError;
use crate::fs_identity::{FsIdentity, IdentityMatch, VolumeKind};
use crate::linked_registry::{LinkRecord, Membership};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct FolderCandidate {
    pub(crate) canonical: PathBuf,
    pub(crate) identity: FsIdentity,
    pub(crate) volume_kind: VolumeKind,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum RebindKind {
    SameFolder,
    DifferentFolder,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LocateFolderOutcome {
    Cancelled,
    Declined,
    Rebound,
}

fn folder_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned())
}

pub(crate) fn not_a_folder() -> String {
    AppError::new("project.folder_not_a_folder").into()
}

pub(crate) fn folder_picker_failed() -> String {
    AppError::new("project.folder_picker_failed").into()
}

pub(crate) fn validate_rebind_candidate(
    project_id: &str,
    path: &Path,
) -> Result<FolderCandidate, String> {
    crate::paths::validate_project_id(project_id)?;
    let denied = |path: &Path| -> String {
        AppError::new("project.linked_permission_denied")
            .param("folder", folder_name(path))
            .into()
    };
    let inaccessible = |error: std::io::Error| match error.kind() {
        std::io::ErrorKind::PermissionDenied => denied(path),
        _ => not_a_folder(),
    };
    std::fs::symlink_metadata(path).map_err(inaccessible)?;
    let canonical = path.canonicalize().map_err(inaccessible)?;
    let metadata = std::fs::symlink_metadata(&canonical).map_err(inaccessible)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() || canonical.to_str().is_none() {
        return Err(not_a_folder());
    }
    match crate::known_folders::scope_of(&canonical, &crate::known_folders::KnownFolders::current())
    {
        crate::known_folders::FolderScope::Narrow => {}
        crate::known_folders::FolderScope::AppData => {
            return Err(AppError::new("project.folder_in_app_data").into());
        }
        crate::known_folders::FolderScope::Broad
        | crate::known_folders::FolderScope::Protected(_) => {
            return Err(AppError::new("project.folder_too_broad")
                .param("name", folder_name(&canonical))
                .into());
        }
    }
    if crate::paths::overlaps_app_data(&canonical)? {
        return Err(AppError::new("project.folder_in_app_data").into());
    }
    if crate::linked_registry::overlapping_link(project_id, &canonical)? {
        return Err(AppError::new("project.folder_already_linked").into());
    }
    let observed =
        crate::fs_identity::identify_directory(&canonical).map_err(|error| match error.kind() {
            std::io::ErrorKind::PermissionDenied => denied(&canonical),
            _ => not_a_folder(),
        })?;
    Ok(FolderCandidate {
        canonical,
        identity: observed.identity,
        volume_kind: observed.volume_kind,
    })
}

pub(crate) fn rebind_kind(saved: &LinkRecord, candidate: &FolderCandidate) -> RebindKind {
    if saved.identity.weak || candidate.identity.weak {
        return RebindKind::DifferentFolder;
    }
    match crate::fs_identity::compare(&saved.identity, &candidate.identity) {
        IdentityMatch::FullMatch | IdentityMatch::SameObjectOtherVolume => RebindKind::SameFolder,
        IdentityMatch::Different | IdentityMatch::Unknown => RebindKind::DifferentFolder,
    }
}

pub(crate) fn apply_rebind(
    data_root: &Path,
    project_id: &str,
    candidate: &FolderCandidate,
    kind: RebindKind,
) -> Result<(), String> {
    let _worktree = match kind {
        RebindKind::SameFolder => {
            crate::worktree_lock::ProjectWorktreeLock::exclusive_for_identity_allocation(
                project_id,
            )?
        }
        RebindKind::DifferentFolder => {
            crate::worktree_lock::ProjectWorktreeLock::exclusive(project_id)?
        }
    };
    if crate::linked_registry::overlapping_link(project_id, &candidate.canonical)? {
        return Err(AppError::new("project.folder_already_linked").into());
    }
    if kind == RebindKind::DifferentFolder {
        crate::project_grants::reset_project_grants(data_root, project_id)?;
    }
    crate::linked_registry::rebind(
        project_id,
        &candidate.canonical,
        &candidate.identity,
        candidate.volume_kind,
    )?;
    Ok(())
}

fn linked_record(project_id: &str) -> Result<LinkRecord, String> {
    crate::paths::validate_project_id(project_id)?;
    match crate::linked_registry::refreshed_membership(project_id)? {
        Membership::Active(member) => Ok(member.record),
        Membership::Corrupt(detail) => Err(AppError::new("project.linked_invalid")
            .detail(detail)
            .into()),
        Membership::Absent => Err(AppError::new("project.not_linked").into()),
    }
}

async fn pick_folder(app: &tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_title(crate::i18n::t("dialog.locateFolder.title"))
        .pick_folder(move |selection| {
            let _ = sender.send(selection);
        });
    let Some(selection) = receiver.await.map_err(|_| folder_picker_failed())? else {
        return Ok(None);
    };
    selection.into_path().map(Some).map_err(|_| not_a_folder())
}

async fn confirm_different_folder<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    name: &str,
) -> Result<bool, String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .message(crate::i18n::t_with(
            "dialog.rebindFolder.message",
            &[("name", name)],
        ))
        .title(crate::i18n::t("dialog.rebindFolder.title"))
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            crate::i18n::t("dialog.rebindFolder.confirm"),
            crate::i18n::t("dialog.cancel"),
        ))
        .show(move |confirmed| {
            let _ = sender.send(confirmed);
        });
    receiver
        .await
        .map_err(|_| crate::i18n::t("errors.approvalDialogClosed"))
}

async fn rebind_with_consent<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: String,
    record: LinkRecord,
    candidate: FolderCandidate,
) -> Result<LocateFolderOutcome, String> {
    use tauri::Manager as _;
    let kind = rebind_kind(&record, &candidate);
    if kind == RebindKind::DifferentFolder
        && !confirm_different_folder(app, &folder_name(&candidate.canonical)).await?
    {
        return Ok(LocateFolderOutcome::Declined);
    }
    let grants_reset = kind == RebindKind::DifferentFolder;
    let acp = app
        .try_state::<Arc<crate::acp::AcpRuntime>>()
        .map(|state| Arc::clone(state.inner()));
    if grants_reset {
        if let Some(acp) = &acp {
            acp.close_project_sessions(&project_id).await;
        }
        crate::terminal::kill_project_sessions(&project_id);
    }
    let data_root = crate::paths::oleafly_root()?;
    let id = project_id.clone();
    let target = candidate.clone();
    tauri::async_runtime::spawn_blocking(move || apply_rebind(&data_root, &id, &target, kind))
        .await
        .map_err(|error| error.to_string())??;
    if let Some(acp) = &acp {
        acp.close_project_sessions(&project_id).await;
        if let Err(error) =
            acp.rebind_project_paths(&project_id, &candidate.canonical, grants_reset)
        {
            let _ = crate::project::append_app_log(format!(
                "Saved agent sessions for {project_id} still point at the old folder: {error}"
            ));
        }
    }
    crate::project_availability::relocated(&project_id, grants_reset);
    if grants_reset {
        use tauri::Emitter as _;
        let _ = app.emit("project-trust-changed", &project_id);
    }
    Ok(LocateFolderOutcome::Rebound)
}

#[tauri::command]
pub async fn locate_project_folder(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<LocateFolderOutcome, String> {
    let lookup = project_id.clone();
    let record = tauri::async_runtime::spawn_blocking(move || linked_record(&lookup))
        .await
        .map_err(|error| error.to_string())??;
    let Some(picked) = pick_folder(&app).await? else {
        return Ok(LocateFolderOutcome::Cancelled);
    };
    let id = project_id.clone();
    let candidate =
        tauri::async_runtime::spawn_blocking(move || validate_rebind_candidate(&id, &picked))
            .await
            .map_err(|error| error.to_string())??;
    rebind_with_consent(&app, project_id, record, candidate).await
}

#[tauri::command]
pub async fn adopt_replaced_folder(
    app: tauri::AppHandle,
    project_id: String,
) -> Result<LocateFolderOutcome, String> {
    adopt_with(&app, project_id).await
}

async fn adopt_with<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    project_id: String,
) -> Result<LocateFolderOutcome, String> {
    let lookup = project_id.clone();
    let (record, candidate) = tauri::async_runtime::spawn_blocking(move || {
        let record = linked_record(&lookup)?;
        let candidate = validate_rebind_candidate(&lookup, Path::new(&record.canonical_path))?;
        Ok::<_, String>((record, candidate))
    })
    .await
    .map_err(|error| error.to_string())??;
    rebind_with_consent(app, project_id, record, candidate).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::approvals::ApprovalMode;
    use crate::trust::testing::LinkedFixture;
    use crate::trust::TrustScope;

    fn mode(project_id: &str) -> ApprovalMode {
        let root = crate::paths::oleafly_root().unwrap();
        crate::approvals::policy_for(&root, project_id, "write_file")
            .unwrap()
            .0
    }

    fn registered_path(project_id: &str) -> String {
        linked_record(project_id).unwrap().canonical_path
    }

    #[test]
    fn a_moved_folder_keeps_its_grants_and_a_different_folder_resets_them() {
        let fixture = LinkedFixture::new();
        let root = crate::paths::oleafly_root().unwrap();
        let (project_id, folder) = fixture.link("before/thesis");
        fixture.trust(&project_id, TrustScope::Folder);
        crate::approvals::set_mode(&root, &project_id, ApprovalMode::FullAccess).unwrap();
        let record = linked_record(&project_id).unwrap();

        let moved = fixture.folders.path().canonicalize().unwrap().join("moved");
        std::fs::rename(&folder, &moved).unwrap();
        let same = validate_rebind_candidate(&project_id, &moved).unwrap();
        assert_eq!(rebind_kind(&record, &same), RebindKind::SameFolder);
        apply_rebind(&root, &project_id, &same, RebindKind::SameFolder).unwrap();
        assert_eq!(mode(&project_id), ApprovalMode::FullAccess);
        assert!(crate::trust::is_trusted(&project_id));
        assert_eq!(registered_path(&project_id), moved.to_str().unwrap());
        assert_eq!(
            crate::project_location::locate(&project_id).unwrap().root,
            moved
        );

        let other = fixture.folders.path().canonicalize().unwrap().join("other");
        std::fs::create_dir(&other).unwrap();
        let rebound = linked_record(&project_id).unwrap();
        let different = validate_rebind_candidate(&project_id, &other).unwrap();
        assert_eq!(
            rebind_kind(&rebound, &different),
            RebindKind::DifferentFolder
        );
        apply_rebind(&root, &project_id, &different, RebindKind::DifferentFolder).unwrap();
        assert_eq!(mode(&project_id), ApprovalMode::ApproveForMe);
        assert!(!crate::trust::is_trusted(&project_id));
        assert_eq!(registered_path(&project_id), other.to_str().unwrap());
        assert!(moved.is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn using_the_folder_behind_a_link_left_at_the_old_path_rebinds_and_keeps_grants() {
        let fixture = LinkedFixture::new();
        let root = crate::paths::oleafly_root().unwrap();
        let (project_id, folder) = fixture.link("before/thesis");
        fixture.trust(&project_id, TrustScope::Folder);
        crate::approvals::set_mode(&root, &project_id, ApprovalMode::FullAccess).unwrap();
        let moved = fixture.folders.path().canonicalize().unwrap().join("moved");
        std::fs::rename(&folder, &moved).unwrap();
        std::os::unix::fs::symlink(&moved, &folder).unwrap();
        assert!(matches!(
            crate::project_location::locate(&project_id),
            Err(crate::project_location::LocateError::Replaced { .. })
        ));

        let app = tauri::test::mock_app();
        let outcome =
            tauri::async_runtime::block_on(adopt_with(app.handle(), project_id.clone())).unwrap();

        assert_eq!(outcome, LocateFolderOutcome::Rebound);
        assert_eq!(registered_path(&project_id), moved.to_str().unwrap());
        assert_eq!(
            crate::project_location::locate(&project_id).unwrap().root,
            moved
        );
        assert_eq!(mode(&project_id), ApprovalMode::FullAccess);
        assert!(crate::trust::is_trusted(&project_id));
    }

    #[test]
    fn candidates_that_overlap_other_projects_or_app_data_or_are_too_broad_are_refused() {
        let fixture = LinkedFixture::new();
        let (first, first_folder) = fixture.link("first");
        let (_, second_folder) = fixture.link("second");
        let inner = second_folder.join("inner");
        std::fs::create_dir(&inner).unwrap();
        let file = fixture.folders.path().join("notes.txt");
        std::fs::write(&file, "x").unwrap();

        let code = |path: &std::path::Path| validate_rebind_candidate(&first, path).unwrap_err();
        assert!(code(&second_folder).contains("project.folder_already_linked"));
        assert!(code(&inner).contains("project.folder_already_linked"));
        assert!(code(fixture.folders.path()).contains("project.folder_already_linked"));
        let data = crate::paths::oleafly_root().unwrap();
        let inside_data = data.join("inside");
        std::fs::create_dir_all(&inside_data).unwrap();
        assert!(code(&inside_data).contains("project.folder_in_app_data"));
        assert!(code(&data).contains("project.folder_in_app_data"));
        assert!(code(&crate::paths::home_dir().unwrap()).contains("project.folder_too_broad"));
        assert!(code(&file).contains("project.folder_not_a_folder"));
        assert!(code(&fixture.folders.path().join("gone")).contains("project.folder_not_a_folder"));
        assert!(validate_rebind_candidate("../escape", &first_folder).is_err());

        let own = validate_rebind_candidate(&first, &first_folder).unwrap();
        assert_eq!(own.canonical, first_folder);
    }

    #[test]
    fn a_pending_restore_blocks_a_different_folder_before_any_grant_is_reset() {
        let fixture = LinkedFixture::new();
        let root = crate::paths::oleafly_root().unwrap();
        let (project_id, folder) = fixture.link("thesis");
        crate::approvals::set_mode(&root, &project_id, ApprovalMode::FullAccess).unwrap();
        let marker = crate::project_location::locate(&project_id)
            .unwrap()
            .restore_marker();
        std::fs::create_dir_all(marker.parent().unwrap()).unwrap();
        std::fs::write(&marker, b"pending").unwrap();
        let other = fixture.folders.path().canonicalize().unwrap().join("other");
        std::fs::create_dir(&other).unwrap();

        let different = validate_rebind_candidate(&project_id, &other).unwrap();
        assert!(apply_rebind(&root, &project_id, &different, RebindKind::DifferentFolder).is_err());
        assert_eq!(mode(&project_id), ApprovalMode::FullAccess);
        assert_eq!(registered_path(&project_id), folder.to_str().unwrap());

        let same = validate_rebind_candidate(&project_id, &folder).unwrap();
        apply_rebind(&root, &project_id, &same, RebindKind::SameFolder).unwrap();
        assert_eq!(mode(&project_id), ApprovalMode::FullAccess);
    }

    #[test]
    fn weak_identities_always_count_as_a_different_folder() {
        let fixture = LinkedFixture::new();
        let (project_id, folder) = fixture.link("usb");
        let mut record = linked_record(&project_id).unwrap();
        let candidate = validate_rebind_candidate(&project_id, &folder).unwrap();
        assert_eq!(rebind_kind(&record, &candidate), RebindKind::SameFolder);
        record.identity.weak = true;
        assert_eq!(
            rebind_kind(&record, &candidate),
            RebindKind::DifferentFolder
        );
    }

    #[test]
    fn only_linked_projects_can_be_located() {
        let _fixture = LinkedFixture::new();
        crate::paths::create_project_dir("paper").unwrap();
        assert!(linked_record("paper")
            .unwrap_err()
            .contains("project.not_linked"));
    }

    #[test]
    fn outcomes_serialize_for_the_webview() {
        assert_eq!(
            serde_json::to_value(LocateFolderOutcome::Rebound).unwrap(),
            serde_json::json!("rebound")
        );
        assert_eq!(
            serde_json::to_value(LocateFolderOutcome::Declined).unwrap(),
            serde_json::json!("declined")
        );
    }
}
