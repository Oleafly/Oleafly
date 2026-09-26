use crate::app_error::AppError;
use crate::fs_identity::IdentityMatch;
use crate::linked_registry::{self, LinkRecord, Membership};
use std::path::{Path, PathBuf};

pub(crate) const LIBRARY_STATE_DIR: &str = ".oleafly";
pub(crate) const MANIFEST_FILE: &str = "project.json";
const LINKED_PRIVATE_STATE_DIR: &str = "state";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ProjectKind {
    Library,
    Linked,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ManifestSource {
    InFolder,
    Sidecar,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ProjectLocation {
    pub(crate) id: String,
    pub(crate) kind: ProjectKind,
    pub(crate) root: PathBuf,
    pub(crate) state_dir: PathBuf,
    pub(crate) manifest: ManifestSource,
    pub(crate) compile_dir: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LocateError {
    NotFound(String),
    Unavailable { id: String, folder: String },
    Replaced { id: String, folder: String },
    PermissionDenied { id: String, folder: String },
    Invalid(String),
}

impl From<LocateError> for String {
    fn from(error: LocateError) -> Self {
        match error {
            LocateError::NotFound(message) | LocateError::Invalid(message) => message,
            LocateError::Unavailable { folder, .. } => AppError::new("project.linked_missing")
                .param("folder", folder)
                .into(),
            LocateError::Replaced { folder, .. } => AppError::new("project.linked_replaced")
                .param("folder", folder)
                .into(),
            LocateError::PermissionDenied { folder, .. } => {
                AppError::new("project.linked_permission_denied")
                    .param("folder", folder)
                    .into()
            }
        }
    }
}

impl ProjectLocation {
    pub(crate) fn library_at(project_id: &str, root: PathBuf) -> Self {
        Self {
            id: project_id.to_owned(),
            kind: ProjectKind::Library,
            state_dir: root.join(LIBRARY_STATE_DIR),
            manifest: ManifestSource::InFolder,
            compile_dir: root.clone(),
            root,
        }
    }

    pub(crate) fn private_state_dir(&self) -> PathBuf {
        private_state_dir(self.kind, &self.state_dir)
    }

    pub(crate) fn move_backups_dir(&self) -> PathBuf {
        self.private_state_dir().join("move-backups")
    }

    pub(crate) fn manifest_path(&self) -> PathBuf {
        match self.manifest {
            ManifestSource::InFolder => self.root.join(MANIFEST_FILE),
            ManifestSource::Sidecar => self.state_dir.join(MANIFEST_FILE),
        }
    }

    pub(crate) fn ensure_linked_state(&self, target: &Path) -> Result<PathBuf, String> {
        let relative = target
            .strip_prefix(&self.state_dir)
            .map_err(|_| "linked project data escapes its registry entry".to_string())?;
        crate::paths::linked_state_directory(&self.state_dir, relative, true)?
            .ok_or_else(|| "linked project data is missing".to_string())
    }

    pub(crate) fn compile_search_dir(&self, main_doc: &str) -> Option<PathBuf> {
        if self.kind != ProjectKind::Linked {
            return None;
        }
        let recorded = self
            .compile_dir
            .strip_prefix(&self.root)
            .ok()
            .map(|relative| relative.to_string_lossy().replace('\\', "/"))
            .filter(|relative| !relative.is_empty());
        let relative = recorded.or_else(|| oleafly_core::compile_dir_for(&self.root, main_doc))?;
        let directory = relative
            .split('/')
            .filter(|part| !part.is_empty())
            .fold(self.root.clone(), |path, part| path.join(part));
        let canonical = directory.canonicalize().ok()?;
        (canonical == directory && canonical.is_dir() && canonical != self.root)
            .then_some(canonical)
    }
}

#[cfg(test)]
impl ProjectLocation {
    pub(crate) fn build_dir(&self) -> PathBuf {
        self.state_dir.join("build")
    }

    pub(crate) fn figure_build_dir(&self) -> PathBuf {
        self.state_dir.join("figbuild")
    }

    pub(crate) fn builds_metadata_dir(&self) -> PathBuf {
        self.state_dir.join("builds")
    }

    pub(crate) fn bib_backups_dir(&self) -> PathBuf {
        self.state_dir.join("backups")
    }

    pub(crate) fn restore_marker(&self) -> PathBuf {
        self.private_state_dir()
            .join(crate::worktree_lock::RESTORE_PENDING_FILE)
    }
}

pub(crate) fn private_state_dir(kind: ProjectKind, state_dir: &Path) -> PathBuf {
    match kind {
        ProjectKind::Library => state_dir.to_path_buf(),
        ProjectKind::Linked => state_dir.join(LINKED_PRIVATE_STATE_DIR),
    }
}

pub(crate) fn locate(project_id: &str) -> Result<ProjectLocation, LocateError> {
    crate::paths::validate_project_id(project_id).map_err(LocateError::Invalid)?;
    let generation = crate::project_availability::location_generation(project_id);
    let registry_failure = match linked_registry::cached_membership(project_id) {
        Ok(Membership::Active(member)) => return observed(project_id, generation, member),
        Ok(Membership::Corrupt(detail)) => return Err(corrupt_link(detail)),
        Ok(Membership::Absent) => None,
        Err(error) => Some(error),
    };
    if let Some(root) =
        crate::paths::library_project_root(project_id).map_err(LocateError::Invalid)?
    {
        return Ok(ProjectLocation::library_at(project_id, root));
    }
    if let Some(error) = registry_failure {
        return Err(corrupt_link(error));
    }
    match linked_registry::refreshed_membership(project_id).map_err(LocateError::Invalid)? {
        Membership::Active(member) => observed(project_id, generation, member),
        Membership::Corrupt(detail) => Err(corrupt_link(detail)),
        Membership::Absent => Err(LocateError::NotFound(format!(
            "project does not exist: {project_id}"
        ))),
    }
}

fn observed(
    project_id: &str,
    generation: u64,
    member: Box<linked_registry::Member>,
) -> Result<ProjectLocation, LocateError> {
    let result = linked_location(member.record, member.state_dir);
    crate::project_availability::observe_location(project_id, generation, &result);
    result
}

pub(crate) fn linked_state_dir(project_id: &str) -> Result<Option<PathBuf>, String> {
    crate::paths::validate_project_id(project_id)?;
    let membership = match linked_registry::cached_membership(project_id) {
        Ok(Membership::Absent)
            if linked_registry::is_linked_id(project_id) && !library_claims(project_id) =>
        {
            linked_registry::refreshed_membership(project_id)?
        }
        Ok(membership) => membership,
        Err(_) if library_claims(project_id) => Membership::Absent,
        Err(error) => return Err(corrupt_link(error).into()),
    };
    match membership {
        Membership::Active(member) => Ok(Some(member.state_dir)),
        Membership::Corrupt(detail) => Err(corrupt_link(detail).into()),
        Membership::Absent => Ok(None),
    }
}

pub(crate) fn kind_of(project_id: &str) -> Result<ProjectKind, String> {
    Ok(if linked_state_dir(project_id)?.is_some() {
        ProjectKind::Linked
    } else {
        ProjectKind::Library
    })
}

fn library_claims(project_id: &str) -> bool {
    !matches!(crate::paths::library_project_root(project_id), Ok(None))
}

fn corrupt_link(detail: String) -> LocateError {
    LocateError::Invalid(
        AppError::new("project.linked_invalid")
            .detail(detail)
            .into(),
    )
}

fn folder_label(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.display().to_string())
}

fn linked_location(record: LinkRecord, state_dir: PathBuf) -> Result<ProjectLocation, LocateError> {
    let recorded = PathBuf::from(&record.canonical_path);
    let folder = folder_label(&recorded);
    let id = record.id.clone();
    let replaced = || LocateError::Replaced {
        id: id.clone(),
        folder: folder.clone(),
    };
    let inaccessible = |error: std::io::Error| match error.kind() {
        std::io::ErrorKind::PermissionDenied => LocateError::PermissionDenied {
            id: id.clone(),
            folder: folder.clone(),
        },
        _ => LocateError::Unavailable {
            id: id.clone(),
            folder: folder.clone(),
        },
    };
    let metadata = std::fs::symlink_metadata(&recorded).map_err(inaccessible)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(replaced());
    }
    if crate::fs_identity::quick_matches(&record.identity, &metadata) == Some(false) {
        return Err(replaced());
    }
    let canonical = recorded.canonicalize().map_err(inaccessible)?;
    if canonical != recorded {
        let observed = crate::fs_identity::identify_directory(&canonical).map_err(|error| {
            match error.kind() {
                std::io::ErrorKind::NotADirectory => replaced(),
                _ => inaccessible(error),
            }
        })?;
        if crate::fs_identity::compare(&record.identity, &observed.identity)
            != IdentityMatch::FullMatch
        {
            return Err(replaced());
        }
    }
    if crate::paths::overlaps_app_data(&canonical).map_err(corrupt_link)? {
        return Err(corrupt_link(
            "a linked folder cannot overlap Oleafly's app data".to_string(),
        ));
    }
    let compile_dir = record
        .compile_dir
        .as_deref()
        .map_or_else(|| canonical.clone(), |relative| canonical.join(relative));
    Ok(ProjectLocation {
        id: record.id,
        kind: ProjectKind::Linked,
        root: canonical,
        state_dir,
        manifest: ManifestSource::Sidecar,
        compile_dir,
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum LibraryDirError {
    Linked,
    NotFound,
    NotLibrary,
    Io(String),
}

impl LibraryDirError {
    pub(crate) fn into_message(self, linked_code: &'static str) -> String {
        match self {
            Self::Linked => AppError::new(linked_code).into(),
            Self::NotFound => AppError::new("project.not_found").into(),
            Self::NotLibrary => AppError::new("project.not_recyclable").into(),
            Self::Io(message) => message,
        }
    }
}

impl From<LibraryDirError> for String {
    fn from(error: LibraryDirError) -> Self {
        error.into_message("project.linked_not_recyclable")
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LibraryProjectDir {
    id: String,
    path: PathBuf,
}

impl LibraryProjectDir {
    pub(crate) fn resolve(project_id: &str) -> Result<Self, LibraryDirError> {
        crate::paths::validate_project_id(project_id).map_err(LibraryDirError::Io)?;
        if linked_registry::id_reserved(project_id).map_err(LibraryDirError::Io)? {
            return Err(LibraryDirError::Linked);
        }
        let projects = crate::paths::projects_root()
            .and_then(|root| {
                root.canonicalize()
                    .map_err(|error| format!("failed to resolve projects root: {error}"))
            })
            .map_err(LibraryDirError::Io)?;
        let candidate = projects.join(project_id);
        let metadata = match std::fs::symlink_metadata(&candidate) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Err(LibraryDirError::NotFound)
            }
            Err(error) => {
                return Err(LibraryDirError::Io(format!(
                    "failed to inspect project before deletion: {error}"
                )))
            }
        };
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || crate::paths::is_reparse_point(&metadata)
        {
            return Err(LibraryDirError::NotLibrary);
        }
        let path = candidate.canonicalize().map_err(|error| {
            LibraryDirError::Io(format!(
                "failed to resolve project before deletion: {error}"
            ))
        })?;
        let named_for_project = path
            .file_name()
            .and_then(std::ffi::OsStr::to_str)
            .is_some_and(|name| name.eq_ignore_ascii_case(project_id));
        if path.parent() != Some(projects.as_path()) || !named_for_project {
            return Err(LibraryDirError::NotLibrary);
        }
        Ok(Self {
            id: project_id.to_string(),
            path,
        })
    }

    pub(crate) fn id(&self) -> &str {
        &self.id
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn revalidate(&self) -> Result<PathBuf, String> {
        let current = Self::resolve(&self.id)?;
        if current.path != self.path {
            return Err(LibraryDirError::NotLibrary.into());
        }
        Ok(current.path)
    }
}

pub(crate) fn refuse_linked(project_id: &str, code: &'static str) -> Result<(), String> {
    crate::paths::validate_project_id(project_id)?;
    if linked_registry::id_reserved(project_id)? {
        return Err(AppError::new(code).into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::linked_registry::{
        folder_snapshot_for_test, register_folder_for_test, update, LINKED_ID_PREFIX, LINK_FILE,
    };

    struct Fixture {
        data: tempfile::TempDir,
        folders: tempfile::TempDir,
        _env: std::sync::MutexGuard<'static, ()>,
    }

    impl Fixture {
        fn new() -> Self {
            let env = crate::paths::data_dir_env_lock();
            let data = tempfile::tempdir().unwrap();
            let folders = tempfile::tempdir().unwrap();
            std::env::set_var("OLEAFLY_DATA_DIR", data.path());
            Self {
                data,
                folders,
                _env: env,
            }
        }

        fn folder(&self, name: &str) -> PathBuf {
            let folder = self.folders.path().join(name);
            std::fs::create_dir_all(&folder).unwrap();
            folder.canonicalize().unwrap()
        }

        fn state(&self, id: &str) -> PathBuf {
            self.data
                .path()
                .canonicalize()
                .unwrap()
                .join("linked")
                .join(id)
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            std::env::remove_var("OLEAFLY_DATA_DIR");
        }
    }

    #[test]
    fn library_locations_match_the_legacy_layout() {
        let fixture = Fixture::new();
        let root = crate::paths::create_project_dir("paper").unwrap();
        let location = locate("paper").unwrap();
        assert_eq!(
            location,
            ProjectLocation {
                id: "paper".into(),
                kind: ProjectKind::Library,
                root: root.clone(),
                state_dir: root.join(".oleafly"),
                manifest: ManifestSource::InFolder,
                compile_dir: root.clone(),
            }
        );
        assert_eq!(location.build_dir(), root.join(".oleafly").join("build"));
        assert_eq!(
            location.figure_build_dir(),
            root.join(".oleafly").join("figbuild")
        );
        assert_eq!(
            location.builds_metadata_dir(),
            root.join(".oleafly").join("builds")
        );
        assert_eq!(
            location.bib_backups_dir(),
            root.join(".oleafly").join("backups")
        );
        assert_eq!(
            location.restore_marker(),
            root.join(".oleafly").join("checkpoint-restore-pending")
        );
        assert_eq!(
            location.move_backups_dir(),
            root.join(".oleafly").join("move-backups")
        );
        assert_eq!(location.manifest_path(), root.join("project.json"));
        assert!(!root.join(".oleafly").exists());
        assert!(!fixture.data.path().join("linked").exists());
        assert!(!fixture.data.path().join(".linked-registry.lock").exists());
    }

    #[test]
    fn library_lookups_never_read_the_folder_registry_after_it_loads() {
        let _fixture = Fixture::new();
        crate::paths::create_project_dir("paper").unwrap();
        locate("paper").unwrap();
        let before = crate::linked_registry::disk_reads_on_this_thread();
        for _ in 0..1_000 {
            crate::paths::project_dir("paper").unwrap();
            crate::paths::existing_build_dir("paper").unwrap();
            crate::worktree_lock::pending_restore_marker_exists("paper").unwrap();
        }
        assert_eq!(crate::linked_registry::disk_reads_on_this_thread(), before);
    }

    #[test]
    fn linked_locations_resolve_to_the_folder_and_central_state() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let before = folder_snapshot_for_test(&folder);
        let record = register_folder_for_test(&folder);
        let location = locate(&record.id).unwrap();
        let state = fixture.state(&record.id);
        assert_eq!(location.id, record.id);
        assert_eq!(location.kind, ProjectKind::Linked);
        assert_eq!(location.root, folder);
        assert_eq!(location.state_dir, state);
        assert_eq!(location.manifest, ManifestSource::Sidecar);
        assert_eq!(location.compile_dir, folder);
        assert_eq!(location.build_dir(), state.join("build"));
        assert_eq!(location.manifest_path(), state.join("project.json"));
        assert_eq!(
            location.restore_marker(),
            state.join("state").join("checkpoint-restore-pending")
        );
        assert_eq!(
            location.move_backups_dir(),
            state.join("state").join("move-backups")
        );
        assert_eq!(crate::paths::project_dir(&record.id).unwrap(), folder);
        assert_eq!(folder_snapshot_for_test(&folder), before);
    }

    #[test]
    fn a_recorded_compile_directory_is_resolved_inside_the_folder() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        update(&record.id, |next| {
            next.compile_dir = Some("paper".into());
            Ok(())
        })
        .unwrap();
        let location = locate(&record.id).unwrap();
        assert_eq!(location.root, folder);
        assert_eq!(location.compile_dir, folder.join("paper"));
    }

    #[test]
    fn only_linked_projects_search_a_nested_compile_directory() {
        let fixture = Fixture::new();
        let folder = fixture.folder("repo");
        std::fs::create_dir_all(folder.join("paper/sections")).unwrap();
        std::fs::write(
            folder.join("paper/main.tex"),
            "\\documentclass{article}\n\\begin{document}\n\\input{sections/intro}\n\\end{document}\n",
        )
        .unwrap();
        std::fs::write(folder.join("paper/sections/intro.tex"), "Intro.").unwrap();
        std::fs::write(folder.join("top.tex"), "\\documentclass{article}\n").unwrap();
        let record = register_folder_for_test(&folder);
        let location = locate(&record.id).unwrap();
        assert_eq!(
            location.compile_search_dir("paper/main.tex"),
            Some(folder.join("paper"))
        );
        assert_eq!(location.compile_search_dir("top.tex"), None);

        update(&record.id, |next| {
            next.compile_dir = Some("paper".into());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            locate(&record.id).unwrap().compile_search_dir("top.tex"),
            Some(folder.join("paper"))
        );

        let library = crate::paths::create_project_dir("library").unwrap();
        std::fs::create_dir_all(library.join("paper/sections")).unwrap();
        std::fs::copy(
            folder.join("paper/main.tex"),
            library.join("paper/main.tex"),
        )
        .unwrap();
        std::fs::write(library.join("paper/sections/intro.tex"), "Intro.").unwrap();
        assert_eq!(
            locate("library")
                .unwrap()
                .compile_search_dir("paper/main.tex"),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_symlinked_compile_directory_is_never_searched() {
        let fixture = Fixture::new();
        let folder = fixture.folder("repo");
        let outside = fixture.folder("outside");
        std::os::unix::fs::symlink(&outside, folder.join("paper")).unwrap();
        let record = register_folder_for_test(&folder);
        update(&record.id, |next| {
            next.compile_dir = Some("paper".into());
            Ok(())
        })
        .unwrap();
        assert_eq!(
            locate(&record.id).unwrap().compile_search_dir("main.tex"),
            None
        );
    }

    #[test]
    fn a_missing_linked_folder_is_unavailable_and_names_the_folder() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        std::fs::remove_dir(&folder).unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(
            matches!(error, LocateError::Unavailable { .. }),
            "{error:?}"
        );
        let message = String::from(error);
        assert!(message.starts_with(crate::app_error::PREFIX));
        assert!(message.contains("project.linked_missing"));
        assert!(message.contains("\"folder\":\"thesis\""));
        assert!(!message.contains(folder.parent().unwrap().to_str().unwrap()));
    }

    #[test]
    fn a_linked_folder_whose_parent_became_a_file_is_unavailable() {
        let fixture = Fixture::new();
        let folder = fixture.folder("outer/thesis");
        let record = register_folder_for_test(&folder);
        let outer = folder.parent().unwrap().to_path_buf();
        std::fs::remove_dir_all(&outer).unwrap();
        std::fs::write(&outer, b"not a folder").unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(
            matches!(error, LocateError::Unavailable { .. }),
            "{error:?}"
        );
        let message = String::from(error);
        assert!(message.contains("project.linked_missing"));
        assert!(message.contains("\"folder\":\"thesis\""));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_that_now_holds_the_data_root_is_refused() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        locate(&record.id).unwrap();
        let moved = folder.join("app-data");
        std::fs::rename(fixture.data.path(), &moved).unwrap();
        std::os::unix::fs::symlink(&moved, fixture.data.path()).unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(matches!(error, LocateError::Invalid(_)), "{error:?}");
        assert!(String::from(error).contains("project.linked_invalid"));
        assert!(crate::paths::project_dir(&record.id).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_moved_inside_the_data_root_is_refused() {
        let fixture = Fixture::new();
        let folder = fixture.folder("before/thesis");
        let record = register_folder_for_test(&folder);
        locate(&record.id).unwrap();
        let before = folder.parent().unwrap().to_path_buf();
        let inside = fixture.data.path().join("inside");
        std::fs::rename(&before, &inside).unwrap();
        std::os::unix::fs::symlink(&inside, &before).unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(matches!(error, LocateError::Invalid(_)), "{error:?}");
        assert!(String::from(error).contains("project.linked_invalid"));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_that_holds_a_redirected_library_is_refused() {
        let fixture = Fixture::new();
        let folder = fixture.folder("volume");
        let record = register_folder_for_test(&folder);
        let library = fixture.folder("volume/library");
        std::os::unix::fs::symlink(&library, fixture.data.path().join("projects")).unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(matches!(error, LocateError::Invalid(_)), "{error:?}");
        assert_eq!(
            crate::paths::create_project_dir("paper").unwrap(),
            library.join("paper")
        );
        assert_eq!(locate("paper").unwrap().root, library.join("paper"));
    }

    #[cfg(unix)]
    #[test]
    fn a_different_folder_at_the_recorded_path_is_replaced() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        let substitute = fixture.folder("substitute");
        std::fs::remove_dir(&folder).unwrap();
        std::fs::rename(&substitute, &folder).unwrap();
        let error = locate(&record.id).unwrap_err();
        assert!(matches!(error, LocateError::Replaced { .. }), "{error:?}");
        assert!(String::from(error).contains("project.linked_replaced"));
    }

    #[test]
    fn a_file_at_the_recorded_path_is_replaced() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        std::fs::remove_dir(&folder).unwrap();
        std::fs::write(&folder, b"not a folder").unwrap();
        assert!(matches!(
            locate(&record.id),
            Err(LocateError::Replaced { .. })
        ));
    }

    #[cfg(unix)]
    #[test]
    fn a_linked_folder_behind_a_closed_parent_reports_permission_denied() {
        use std::os::unix::fs::PermissionsExt as _;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let fixture = Fixture::new();
        let folder = fixture.folder("outer/thesis");
        let record = register_folder_for_test(&folder);
        let outer = folder.parent().unwrap().to_path_buf();
        std::fs::set_permissions(&outer, std::fs::Permissions::from_mode(0o000)).unwrap();
        let error = locate(&record.id).unwrap_err();
        std::fs::set_permissions(&outer, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            matches!(error, LocateError::PermissionDenied { .. }),
            "{error:?}"
        );
        assert!(String::from(error).contains("project.linked_permission_denied"));
    }

    #[cfg(unix)]
    #[test]
    fn the_same_folder_reached_through_a_swapped_parent_resolves_to_its_real_path() {
        let fixture = Fixture::new();
        let folder = fixture.folder("before/thesis");
        let record = register_folder_for_test(&folder);
        let before = folder.parent().unwrap().to_path_buf();
        let after = before.with_file_name("after");
        std::fs::rename(&before, &after).unwrap();
        std::os::unix::fs::symlink(&after, &before).unwrap();
        assert_eq!(locate(&record.id).unwrap().root, after.join("thesis"));
    }

    #[cfg(unix)]
    #[test]
    fn an_unopenable_folder_reached_through_a_swapped_parent_reports_permission_denied() {
        use std::os::unix::fs::PermissionsExt as _;
        if unsafe { libc::geteuid() } == 0 {
            return;
        }
        let fixture = Fixture::new();
        let folder = fixture.folder("before/thesis");
        let record = register_folder_for_test(&folder);
        let before = folder.parent().unwrap().to_path_buf();
        let after = before.with_file_name("after");
        std::fs::rename(&before, &after).unwrap();
        std::os::unix::fs::symlink(&after, &before).unwrap();
        let moved = after.join("thesis");
        std::fs::set_permissions(&moved, std::fs::Permissions::from_mode(0o000)).unwrap();
        let error = locate(&record.id).unwrap_err();
        std::fs::set_permissions(&moved, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert!(
            matches!(error, LocateError::PermissionDenied { .. }),
            "{error:?}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_different_folder_reached_through_a_swapped_parent_is_replaced() {
        let fixture = Fixture::new();
        let folder = fixture.folder("before/thesis");
        let record = register_folder_for_test(&folder);
        let before = folder.parent().unwrap().to_path_buf();
        let decoy = fixture.folder("decoy/thesis");
        std::fs::remove_dir(&folder).unwrap();
        std::fs::remove_dir(&before).unwrap();
        std::os::unix::fs::symlink(decoy.parent().unwrap(), &before).unwrap();
        assert!(matches!(
            locate(&record.id),
            Err(LocateError::Replaced { .. })
        ));
    }

    #[test]
    fn removed_and_unknown_linked_ids_read_as_missing_projects() {
        let fixture = Fixture::new();
        let record = register_folder_for_test(&fixture.folder("thesis"));
        update(&record.id, |next| {
            next.removed_at = Some(1);
            Ok(())
        })
        .unwrap();
        assert_eq!(
            String::from(locate(&record.id).unwrap_err()),
            format!("project does not exist: {}", record.id)
        );
        assert_eq!(
            crate::paths::project_dir(&record.id).unwrap_err(),
            format!("project does not exist: {}", record.id)
        );
        let unknown = format!("{LINKED_ID_PREFIX}{:032x}", 77);
        assert!(matches!(locate(&unknown), Err(LocateError::NotFound(_))));
    }

    #[test]
    fn a_corrupt_link_is_invalid_and_never_falls_back() {
        let fixture = Fixture::new();
        let record = register_folder_for_test(&fixture.folder("thesis"));
        std::fs::write(fixture.state(&record.id).join(LINK_FILE), b"{broken").unwrap();
        let message = String::from(locate(&record.id).unwrap_err());
        assert!(message.contains("project.linked_invalid"));
    }

    #[test]
    fn dispatch_is_by_registry_membership_not_by_prefix() {
        let _fixture = Fixture::new();
        let copied = format!("{LINKED_ID_PREFIX}{:032x}", 21);
        let root = crate::paths::create_project_dir(&copied).unwrap();
        let location = locate(&copied).unwrap();
        assert_eq!(location.kind, ProjectKind::Library);
        assert_eq!(location.root, root);
    }

    #[test]
    fn records_written_by_another_process_are_found_and_rebinds_are_followed() {
        let fixture = Fixture::new();
        let first = register_folder_for_test(&fixture.folder("first"));
        locate(&first.id).unwrap();

        let second_folder = fixture.folder("second-folder");
        let mut second = first.clone();
        second.id = format!("{LINKED_ID_PREFIX}{:032x}", 42);
        second.canonical_path = second_folder.to_str().unwrap().to_owned();
        second.identity = crate::fs_identity::identify_directory(&second_folder)
            .unwrap()
            .identity;
        std::fs::create_dir(fixture.state(&second.id)).unwrap();
        std::fs::write(
            fixture.state(&second.id).join(LINK_FILE),
            serde_json::to_vec_pretty(&second).unwrap(),
        )
        .unwrap();
        assert_eq!(locate(&second.id).unwrap().root, second_folder);

        let moved = fixture.folder("first-moved-elsewhere");
        let mut rebound = first.clone();
        rebound.canonical_path = moved.to_str().unwrap().to_owned();
        rebound.identity = crate::fs_identity::identify_directory(&moved)
            .unwrap()
            .identity;
        std::fs::write(
            fixture.state(&first.id).join(LINK_FILE),
            serde_json::to_vec_pretty(&rebound).unwrap(),
        )
        .unwrap();
        assert_eq!(locate(&first.id).unwrap().root, moved);
    }

    #[test]
    fn registrations_belong_to_their_own_data_root() {
        let fixture = Fixture::new();
        let record = register_folder_for_test(&fixture.folder("thesis"));
        let other = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", other.path());
        assert!(matches!(locate(&record.id), Err(LocateError::NotFound(_))));
        std::env::set_var("OLEAFLY_DATA_DIR", fixture.data.path());
        assert!(locate(&record.id).is_ok());
    }

    #[test]
    fn a_broken_registry_never_blocks_library_projects() {
        let fixture = Fixture::new();
        crate::paths::create_project_dir("paper").unwrap();
        let copied = format!("{LINKED_ID_PREFIX}{:032x}", 22);
        let copied_root = crate::paths::create_project_dir(&copied).unwrap();
        std::fs::write(fixture.data.path().join("linked"), b"not a directory").unwrap();
        assert_eq!(locate("paper").unwrap().kind, ProjectKind::Library);
        assert_eq!(locate(&copied).unwrap().root, copied_root);
        let linked = format!("{LINKED_ID_PREFIX}{:032x}", 3);
        let error = locate(&linked).unwrap_err();
        assert!(matches!(error, LocateError::Invalid(_)), "{error:?}");
        assert!(String::from(error).contains("project.linked_invalid"));
    }

    #[test]
    fn linked_build_directories_live_in_central_state() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        let state = fixture.state(&record.id);
        let before = folder_snapshot_for_test(&folder);
        assert_eq!(crate::paths::existing_build_dir(&record.id).unwrap(), None);
        assert_eq!(
            crate::paths::build_dir(&record.id).unwrap(),
            state.join("build")
        );
        assert_eq!(
            crate::paths::figure_build_dir(&record.id).unwrap(),
            state.join("figbuild")
        );
        assert_eq!(
            crate::paths::builds_metadata_dir(&record.id).unwrap(),
            state.join("builds")
        );
        assert_eq!(
            crate::paths::existing_build_dir(&record.id).unwrap(),
            Some(state.join("build"))
        );
        assert_eq!(
            crate::paths::existing_figure_build_dir(&record.id).unwrap(),
            Some(state.join("figbuild"))
        );
        assert_eq!(folder_snapshot_for_test(&folder), before);
    }

    #[test]
    fn existing_linked_builds_stay_readable_while_the_folder_is_away() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        let build = crate::paths::build_dir(&record.id).unwrap();
        std::fs::remove_dir(&folder).unwrap();
        assert!(locate(&record.id).is_err());
        assert_eq!(
            crate::paths::existing_build_dir(&record.id).unwrap(),
            Some(build)
        );
    }

    #[test]
    fn a_cli_build_inside_a_linked_folder_is_never_read_as_oleaflys_own() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        std::fs::create_dir_all(folder.join(".oleafly").join("build")).unwrap();
        std::fs::write(
            folder
                .join(".oleafly")
                .join("build")
                .join("_oleafly_entry.pdf"),
            b"%PDF-cli",
        )
        .unwrap();
        let record = register_folder_for_test(&folder);
        assert_eq!(crate::paths::existing_build_dir(&record.id).unwrap(), None);
        assert_eq!(
            crate::document_engine::existing_compiled_pdf_path(&record.id, "xetex", "main.tex")
                .unwrap(),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn linked_state_lookups_refuse_a_substituted_build_directory() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let outside = fixture.folder("outside");
        let record = register_folder_for_test(&folder);
        std::os::unix::fs::symlink(&outside, fixture.state(&record.id).join("build")).unwrap();
        assert!(crate::paths::existing_build_dir(&record.id).is_err());
        assert!(crate::paths::build_dir(&record.id).is_err());
        assert!(!outside.join(".oleafly").exists());
    }

    #[test]
    fn a_corrupt_link_fails_state_lookups_instead_of_reading_the_folder() {
        let fixture = Fixture::new();
        let folder = fixture.folder("thesis");
        let record = register_folder_for_test(&folder);
        std::fs::write(fixture.state(&record.id).join(LINK_FILE), b"{broken").unwrap();
        let error = crate::paths::existing_build_dir(&record.id).unwrap_err();
        assert!(error.contains("project.linked_invalid"), "{error}");
        assert!(crate::paths::build_dir(&record.id).is_err());
        assert!(!folder.join(".oleafly").exists());
    }

    #[test]
    fn state_lookups_for_a_hand_copied_linked_library_folder_stay_in_the_library() {
        let fixture = Fixture::new();
        std::fs::write(fixture.data.path().join("linked"), b"not a directory").unwrap();
        let copied = format!("{LINKED_ID_PREFIX}{:032x}", 23);
        let root = crate::paths::create_project_dir(&copied).unwrap();
        assert_eq!(linked_state_dir(&copied).unwrap(), None);
        assert_eq!(
            crate::paths::build_dir(&copied).unwrap(),
            root.join(".oleafly").join("build")
        );
        assert_eq!(
            crate::paths::existing_build_dir(&copied).unwrap(),
            Some(root.join(".oleafly").join("build"))
        );
        let unknown = format!("{LINKED_ID_PREFIX}{:032x}", 24);
        assert!(linked_state_dir(&unknown)
            .unwrap_err()
            .contains("project.linked_invalid"));
    }

    #[test]
    fn unknown_and_library_ids_have_no_linked_state() {
        let _fixture = Fixture::new();
        crate::paths::create_project_dir("paper").unwrap();
        assert_eq!(linked_state_dir("paper").unwrap(), None);
        assert_eq!(linked_state_dir("missing").unwrap(), None);
        let unknown = format!("{LINKED_ID_PREFIX}{:032x}", 25);
        assert_eq!(linked_state_dir(&unknown).unwrap(), None);
        assert_eq!(
            crate::paths::existing_build_dir("missing").unwrap_err(),
            "project does not exist: missing"
        );
    }

    #[test]
    fn library_project_dir_is_only_built_for_real_library_directories() {
        let fixture = Fixture::new();
        let projects = crate::paths::projects_root().unwrap();
        std::fs::create_dir(projects.join("paper")).unwrap();
        std::fs::write(projects.join("notes"), b"not a directory").unwrap();
        let folder = fixture.folder("thesis");
        std::fs::write(folder.join("main.tex"), b"keep").unwrap();
        let linked = register_folder_for_test(&folder);
        std::fs::create_dir(projects.join(&linked.id)).unwrap();

        let library = LibraryProjectDir::resolve("paper").unwrap();
        assert_eq!(library.id(), "paper");
        assert_eq!(
            library.path(),
            projects.join("paper").canonicalize().unwrap()
        );
        assert_eq!(
            LibraryProjectDir::resolve(&linked.id).unwrap_err(),
            LibraryDirError::Linked
        );
        assert_eq!(
            LibraryProjectDir::resolve("missing").unwrap_err(),
            LibraryDirError::NotFound
        );
        assert_eq!(
            LibraryProjectDir::resolve("notes").unwrap_err(),
            LibraryDirError::NotLibrary
        );
        assert!(matches!(
            LibraryProjectDir::resolve("../paper").unwrap_err(),
            LibraryDirError::Io(_)
        ));

        let message: String = LibraryDirError::Linked.into();
        assert!(
            message.contains("\"code\":\"project.linked_not_recyclable\""),
            "{message}"
        );
        assert!(LibraryDirError::Linked
            .into_message("project.linked_not_duplicable")
            .contains("\"code\":\"project.linked_not_duplicable\""));
        assert!(refuse_linked(&linked.id, "project.linked_not_duplicable")
            .unwrap_err()
            .contains("\"code\":\"project.linked_not_duplicable\""));
        refuse_linked("paper", "project.linked_not_duplicable").unwrap();

        update(&linked.id, |next| {
            next.removed_at = Some(1);
            Ok(())
        })
        .unwrap();
        assert_eq!(
            LibraryProjectDir::resolve(&linked.id).unwrap_err(),
            LibraryDirError::Linked
        );
        assert!(folder.join("main.tex").is_file());
    }

    #[cfg(unix)]
    #[test]
    fn library_project_dir_refuses_a_symlinked_library_entry() {
        let fixture = Fixture::new();
        let projects = crate::paths::projects_root().unwrap();
        let outside = fixture.folder("outside");
        std::fs::write(outside.join("main.tex"), b"keep").unwrap();
        std::os::unix::fs::symlink(&outside, projects.join("paper")).unwrap();

        assert_eq!(
            LibraryProjectDir::resolve("paper").unwrap_err(),
            LibraryDirError::NotLibrary
        );
        assert!(outside.join("main.tex").is_file());
    }

    #[test]
    #[ignore]
    fn library_lookup_overhead() {
        let _fixture = Fixture::new();
        crate::paths::create_project_dir("paper").unwrap();
        locate("paper").unwrap();
        let rounds: u32 = 20_000;
        let started = std::time::Instant::now();
        for _ in 0..rounds {
            crate::paths::library_project_root("paper").unwrap();
        }
        let legacy = started.elapsed() / rounds;
        let started = std::time::Instant::now();
        for _ in 0..rounds {
            locate("paper").unwrap();
        }
        eprintln!(
            "legacy {legacy:?}/call, locate {:?}/call",
            started.elapsed() / rounds
        );
    }

    #[test]
    fn linked_caches_are_tagged_and_library_builds_are_not() {
        let fixture = Fixture::new();
        let record = register_folder_for_test(&fixture.folder("thesis"));
        assert!(crate::paths::build_dir(&record.id)
            .unwrap()
            .join("CACHEDIR.TAG")
            .is_file());
        assert!(crate::paths::figure_build_dir(&record.id)
            .unwrap()
            .join("CACHEDIR.TAG")
            .is_file());
        assert!(!crate::paths::builds_metadata_dir(&record.id)
            .unwrap()
            .join("CACHEDIR.TAG")
            .exists());
        crate::paths::create_project_dir("paper").unwrap();
        assert!(!crate::paths::build_dir("paper")
            .unwrap()
            .join("CACHEDIR.TAG")
            .exists());
    }
}
