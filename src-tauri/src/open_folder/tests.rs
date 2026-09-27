use super::matching::OverlapChild;
use super::*;
use crate::known_folders::KnownFolders;
use crate::linked_registry::ReattachReason;
use crate::research_workspace::{
    roots, AddResearchRootRequest, ResearchRootAccess, ResearchRootRole,
};
use std::ffi::OsString;
use std::path::{Path, PathBuf};

struct Fixture {
    _guard: std::sync::MutexGuard<'static, ()>,
    temp: tempfile::TempDir,
    previous: Option<OsString>,
}

impl Fixture {
    fn new() -> Self {
        let guard = crate::paths::data_dir_env_lock();
        let temp = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::fs::create_dir(temp.path().join("data")).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", temp.path().join("data"));
        Self {
            _guard: guard,
            temp,
            previous,
        }
    }

    fn folder(&self, relative: &str) -> PathBuf {
        let path = self.temp.path().join(relative);
        std::fs::create_dir_all(&path).unwrap();
        path.canonicalize().unwrap()
    }

    fn known(&self) -> KnownFolders {
        KnownFolders::current()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
    }
}

fn library_project(id: &str, name: &str) -> PathBuf {
    let project = crate::paths::projects_root().unwrap().join(id);
    std::fs::create_dir(&project).unwrap();
    std::fs::write(
        project.join("project.json"),
        format!(r#"{{"name":"{name}"}}"#),
    )
    .unwrap();
    project.canonicalize().unwrap()
}

fn text(path: &Path) -> String {
    path.to_str().unwrap().to_string()
}

fn records() -> Vec<crate::linked_registry::LinkRecord> {
    crate::linked_registry::list()
        .unwrap()
        .into_iter()
        .filter_map(|entry| match entry {
            crate::linked_registry::LinkEntry::Record(record) => Some(*record),
            crate::linked_registry::LinkEntry::Corrupt { .. } => None,
        })
        .collect()
}

fn has_birth_time() -> bool {
    records()
        .iter()
        .all(|record| record.identity.birth_ns.is_some())
}

fn inspected(result: Result<Inspection, OpenFolderError>) -> InspectedFolder {
    match result.unwrap() {
        Inspection::Folder(folder) => folder,
        other => panic!("{other:?}"),
    }
}

#[test]
fn relative_missing_and_file_paths_are_refused_with_typed_errors() {
    let fixture = Fixture::new();
    let known = fixture.known();
    assert_eq!(
        inspect_folder_with(Path::new("paper"), &known),
        Err(OpenFolderError::NotAbsolute)
    );
    assert_eq!(
        inspect_folder_with(&fixture.temp.path().join("missing"), &known),
        Err(OpenFolderError::NotFound)
    );
    let file = fixture.folder("work").join("main.tex");
    std::fs::write(&file, "x").unwrap();
    assert_eq!(
        inspect_folder_with(&file, &known),
        Err(OpenFolderError::NotAFolder)
    );
    assert_eq!(
        inspect_folder_with(&file.join("child"), &known),
        Err(OpenFolderError::NotFound)
    );
}

#[test]
fn a_plain_folder_is_inspected_at_its_canonical_path_with_its_identity() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let folder = inspected(inspect_folder(&fixture.temp.path().join("work/./paper")));
    let observed = crate::fs_identity::identify_directory(&paper).unwrap();
    assert_eq!(folder.canonical, paper);
    assert_eq!(folder.canonical_text, paper.to_str().unwrap());
    assert_eq!(folder.identity, observed.identity);
    assert_eq!(folder.case, observed.case);
    assert_eq!(folder.reparse, crate::paths::ReparseClass::None);
    assert!(std::fs::read_dir(&paper).unwrap().next().is_none());
}

#[test]
fn the_data_root_its_contents_and_its_ancestors_are_refused() {
    let fixture = Fixture::new();
    let inside = [
        fixture.folder("data"),
        fixture.folder("data/checkpoints"),
        crate::paths::projects_root().unwrap(),
    ];
    let known = fixture.known();
    for folder in inside {
        assert_eq!(
            inspect_folder_with(&folder, &known),
            Err(OpenFolderError::AppData),
            "{folder:?}"
        );
    }
    assert!(matches!(
        inspect_folder_with(fixture.temp.path(), &known),
        Err(OpenFolderError::TooBroad { .. })
    ));
}

#[test]
fn the_filesystem_root_home_and_temp_root_are_too_broad() {
    let fixture = Fixture::new();
    let known = fixture.known();
    let mut broad = vec![std::env::temp_dir()];
    broad.extend(crate::paths::home_dir().ok());
    #[cfg(unix)]
    broad.push(PathBuf::from("/"));
    #[cfg(windows)]
    broad.push(PathBuf::from(format!(
        "{}\\",
        std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into())
    )));
    for folder in broad {
        assert!(
            matches!(
                inspect_folder_with(&folder, &known),
                Err(OpenFolderError::TooBroad { .. })
            ),
            "{folder:?}"
        );
    }
}

#[test]
fn refusals_name_the_folder_the_user_sees() {
    let fixture = Fixture::new();
    let known = fixture.known();
    let temp = std::env::temp_dir().canonicalize().unwrap();
    assert_eq!(
        inspect_folder_with(&temp, &known),
        Err(OpenFolderError::TooBroad {
            name: temp.file_name().unwrap().to_string_lossy().into_owned()
        })
    );
    let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
    let bundle = known
        .protected
        .iter()
        .find(|folder| executable.starts_with(folder))
        .unwrap()
        .clone();
    assert_eq!(
        inspect_folder_with(&bundle, &known),
        Err(OpenFolderError::Protected {
            name: bundle.file_name().unwrap().to_string_lossy().into_owned()
        })
    );
    #[cfg(target_os = "macos")]
    let (system, name) = (PathBuf::from("/System/Library"), "System");
    #[cfg(target_os = "linux")]
    let (system, name) = (PathBuf::from("/usr/share"), "usr");
    #[cfg(windows)]
    let (system, name) = (
        PathBuf::from(std::env::var_os("SystemRoot").unwrap()).join("System32"),
        "Windows",
    );
    assert_eq!(
        inspect_folder_with(&system, &known),
        Err(OpenFolderError::Protected { name: name.into() })
    );
}

#[test]
fn paths_inside_library_projects_resolve_to_the_project_and_a_reveal_path() {
    let fixture = Fixture::new();
    let project = library_project("alpha", "Alpha");
    std::fs::create_dir_all(project.join("sections/intro")).unwrap();
    std::fs::create_dir_all(project.join(".oleafly/build")).unwrap();
    let scratch = library_project(crate::project::SCRATCH_PROJECT_ID, "Scratch");
    let staging = crate::paths::projects_root()
        .unwrap()
        .join(".oleafly-import-1");
    std::fs::create_dir(&staging).unwrap();
    let known = fixture.known();
    let library = |reveal: Option<&str>| {
        Ok(Inspection::Library {
            project_id: "alpha".into(),
            reveal: reveal.map(str::to_string),
        })
    };
    assert_eq!(inspect_folder_with(&project, &known), library(None));
    assert_eq!(
        inspect_folder_with(&project.join("sections/intro"), &known),
        library(Some("sections/intro"))
    );
    assert_eq!(
        inspect_folder_with(&project.join(".oleafly/build"), &known),
        library(None)
    );
    for refused in [scratch, staging] {
        assert_eq!(
            inspect_folder_with(&refused, &known),
            Err(OpenFolderError::AppData),
            "{refused:?}"
        );
    }
    assert!(!fixture.temp.path().join("data/linked").exists());
}

#[cfg(unix)]
#[test]
fn a_symlinked_folder_is_inspected_at_its_target_and_a_dangling_link_is_not_found() {
    let fixture = Fixture::new();
    let known = fixture.known();
    let target = fixture.folder("work/paper");
    let link = fixture.temp.path().join("work").join("link");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    assert_eq!(
        inspected(inspect_folder_with(&link, &known)).canonical,
        target
    );
    let dangling = fixture.temp.path().join("work/dangling");
    std::os::unix::fs::symlink(fixture.temp.path().join("work/gone"), &dangling).unwrap();
    assert_eq!(
        inspect_folder_with(&dangling, &known),
        Err(OpenFolderError::NotFound)
    );
}

#[cfg(unix)]
#[test]
fn a_folder_the_app_cannot_reach_is_permission_denied() {
    use std::os::unix::fs::PermissionsExt as _;
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipping: root ignores folder permissions");
        return;
    }
    let fixture = Fixture::new();
    let known = fixture.known();
    let locked = fixture.folder("work/locked");
    let child = fixture.folder("work/locked/paper");
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o000)).unwrap();
    let result = inspect_folder_with(&child, &known);
    std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(result, Err(OpenFolderError::PermissionDenied));
}

#[cfg(target_os = "linux")]
#[test]
fn a_path_that_is_not_unicode_is_refused() {
    use std::os::unix::ffi::OsStrExt as _;
    let fixture = Fixture::new();
    let known = fixture.known();
    let folder = fixture
        .folder("work")
        .join(std::ffi::OsStr::from_bytes(b"paper-\xff"));
    std::fs::create_dir(&folder).unwrap();
    assert_eq!(
        inspect_folder_with(&folder, &known),
        Err(OpenFolderError::NotUnicode)
    );
}

#[cfg(windows)]
fn make_junction(link: &Path, target: &Path) {
    let plain = |path: &Path| {
        let text = path.to_string_lossy().replace('/', "\\");
        text.strip_prefix(r"\\?\")
            .map(str::to_owned)
            .unwrap_or(text)
    };
    let output = std::process::Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(plain(link))
        .arg(plain(target))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "mklink /J failed: {}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

#[cfg(windows)]
#[test]
fn a_junction_is_inspected_at_the_folder_it_points_to() {
    let fixture = Fixture::new();
    let known = fixture.known();
    let target = fixture.folder("work/paper");
    let link = fixture.temp.path().join("work").join("link");
    make_junction(&link, &target);
    assert_eq!(
        inspected(inspect_folder_with(&link, &known)).canonical,
        target
    );
}

#[test]
fn a_path_inside_a_library_project_opens_that_project_without_registering_it() {
    let fixture = Fixture::new();
    let project = library_project("alpha", "Alpha");
    std::fs::create_dir_all(project.join("sections/intro")).unwrap();
    assert_eq!(
        register_or_resolve_folder(&project.join("sections/intro")).unwrap(),
        OpenedFolder::library("alpha".into(), Some("sections/intro".into()))
    );
    assert_eq!(register_or_resolve_folder(&project).unwrap().reveal, None);
    let scratch = library_project(crate::project::SCRATCH_PROJECT_ID, "Scratch");
    assert_eq!(
        register_or_resolve_folder(&scratch),
        Err(OpenFolderError::AppData)
    );
    assert!(!fixture.temp.path().join("data/linked").exists());
}

#[test]
fn opening_a_new_folder_registers_it_once_and_writes_nothing_inside() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let first = register_or_resolve_folder(&paper).unwrap();
    assert!(
        crate::linked_registry::is_linked_id(&first.project_id),
        "{}",
        first.project_id
    );
    assert_eq!(
        (first.kind, first.outcome.clone(), first.reattach.clone()),
        (OpenedKind::Linked, FolderOutcome::New, None)
    );
    let second = register_or_resolve_folder(&paper).unwrap();
    assert_eq!(second.project_id, first.project_id);
    assert_eq!(second.outcome, FolderOutcome::Existing);
    let records = records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].canonical_path, text(&paper));
    assert!(std::fs::read_dir(&paper).unwrap().next().is_none());
    assert_eq!(
        crate::project_location::locate(&first.project_id)
            .unwrap()
            .root,
        paper
    );
}

#[test]
fn a_subfolder_opens_the_registered_project_and_an_ancestor_is_refused() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/thesis/paper");
    let chapters = fixture.folder("work/thesis/paper/chapters");
    let opened = register_or_resolve_folder(&paper).unwrap();
    assert_eq!(
        register_or_resolve_folder(&chapters).unwrap(),
        OpenedFolder::linked(
            opened.project_id.clone(),
            Some("chapters".into()),
            FolderOutcome::Existing,
            None
        )
    );
    assert_eq!(
        register_or_resolve_folder(&fixture.folder("work/thesis")),
        Err(OpenFolderError::ContainsProjects {
            children: vec![OverlapChild {
                id: opened.project_id.clone(),
                name: "paper".into(),
                relative_path: "paper".into()
            }]
        })
    );
    assert_eq!(records().len(), 1);
}

#[test]
fn a_renamed_folder_keeps_its_id() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let opened = register_or_resolve_folder(&paper).unwrap();
    if !has_birth_time() {
        eprintln!("skipping: this filesystem reports no birth time");
        return;
    }
    let renamed = fixture.temp.path().join("work/renamed");
    std::fs::rename(&paper, &renamed).unwrap();
    let renamed = renamed.canonicalize().unwrap();
    let moved = register_or_resolve_folder(&renamed).unwrap();
    assert_eq!(moved.project_id, opened.project_id);
    assert_eq!(moved.outcome, FolderOutcome::Moved { from: text(&paper) });
    assert_eq!(records()[0].canonical_path, text(&renamed));
    assert_eq!(
        crate::project_location::locate(&opened.project_id)
            .unwrap()
            .root,
        renamed
    );
}

#[test]
fn a_copied_folder_gets_its_own_id() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    std::fs::write(paper.join("main.tex"), "x").unwrap();
    let original = register_or_resolve_folder(&paper).unwrap();
    let copy = fixture.folder("work/copy");
    std::fs::copy(paper.join("main.tex"), copy.join("main.tex")).unwrap();
    let copied = register_or_resolve_folder(&copy).unwrap();
    assert_ne!(copied.project_id, original.project_id);
    assert_eq!(copied.outcome, FolderOutcome::New);
}

#[test]
fn a_folder_moved_onto_a_registered_path_takes_it_over() {
    let fixture = Fixture::new();
    let first_path = fixture.folder("work/a");
    let second_path = fixture.folder("work/b");
    let first = register_or_resolve_folder(&first_path).unwrap();
    let second = register_or_resolve_folder(&second_path).unwrap();
    if !has_birth_time() {
        eprintln!("skipping: this filesystem reports no birth time");
        return;
    }
    std::fs::remove_dir(&second_path).unwrap();
    std::fs::rename(&first_path, &second_path).unwrap();
    let moved = register_or_resolve_folder(&second_path).unwrap();
    assert_eq!(moved.project_id, first.project_id);
    let records = records();
    let old = records
        .iter()
        .find(|record| record.id == second.project_id)
        .unwrap();
    assert_eq!(
        old.displaced.as_ref().map(|value| value.by.as_str()),
        Some(first.project_id.as_str())
    );
}

#[test]
fn two_simultaneous_opens_of_a_new_folder_share_one_id() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let barrier = barrier.clone();
            let paper = paper.clone();
            std::thread::spawn(move || {
                barrier.wait();
                register_or_resolve_folder(&paper).unwrap().project_id
            })
        })
        .collect();
    let ids: Vec<String> = handles
        .into_iter()
        .map(|handle| handle.join().unwrap())
        .collect();
    assert_eq!(ids[0], ids[1]);
    assert_eq!(records().len(), 1);
}

#[cfg(target_os = "macos")]
#[test]
fn composed_and_decomposed_spellings_open_the_same_folder_on_macos() {
    let fixture = Fixture::new();
    let work = fixture.folder("work");
    let decomposed = work.join("re\u{301}sume\u{301}");
    std::fs::create_dir(&decomposed).unwrap();
    let first = register_or_resolve_folder(&work.join("r\u{e9}sum\u{e9}")).unwrap();
    let second = register_or_resolve_folder(&decomposed).unwrap();
    assert_eq!(first.project_id, second.project_id);
    assert_eq!(second.outcome, FolderOutcome::Existing);
    assert!(records()[0]
        .canonical_path
        .ends_with("re\u{301}sume\u{301}"));
}

#[cfg(target_os = "linux")]
#[test]
fn composed_and_decomposed_spellings_are_different_folders_on_linux() {
    let fixture = Fixture::new();
    let composed = fixture.folder("work/r\u{e9}sum\u{e9}");
    let decomposed = fixture.folder("work/re\u{301}sume\u{301}");
    assert_ne!(
        register_or_resolve_folder(&composed).unwrap().project_id,
        register_or_resolve_folder(&decomposed).unwrap().project_id
    );
}

#[cfg(any(target_os = "macos", windows))]
#[test]
fn a_case_only_rename_keeps_subfolders_inside_the_registered_project() {
    let fixture = Fixture::new();
    let work = fixture.folder("work");
    let paper = fixture.folder("work/Paper");
    if crate::fs_identity::identify_directory(&paper).unwrap().case
        != crate::fs_identity::CaseSensitivity::Insensitive
    {
        eprintln!("skipping: case-sensitive volume");
        return;
    }
    fixture.folder("work/Paper/chapters");
    let opened = register_or_resolve_folder(&paper).unwrap();
    std::fs::rename(work.join("Paper"), work.join("paper")).unwrap();
    let inside = register_or_resolve_folder(&work.join("paper").join("chapters")).unwrap();
    assert_eq!(
        (inside.project_id.as_str(), inside.reveal.as_deref()),
        (opened.project_id.as_str(), Some("chapters"))
    );
    let again = register_or_resolve_folder(&work.join("paper")).unwrap();
    assert_eq!(again.outcome, FolderOutcome::Existing);
    assert!(records()[0].canonical_path.ends_with("paper"));
}

#[cfg(target_os = "linux")]
#[test]
fn case_variants_are_different_folders_on_case_sensitive_volumes() {
    let fixture = Fixture::new();
    let upper = fixture.folder("work/Paper");
    let lower = fixture.folder("work/paper");
    if crate::fs_identity::identify_directory(&upper).unwrap().case
        == crate::fs_identity::CaseSensitivity::Insensitive
    {
        eprintln!("skipping: case-insensitive volume");
        return;
    }
    assert_ne!(
        register_or_resolve_folder(&upper).unwrap().project_id,
        register_or_resolve_folder(&lower).unwrap().project_id
    );
}

#[cfg(windows)]
#[test]
fn a_junction_and_its_target_are_one_project() {
    let fixture = Fixture::new();
    let target = fixture.folder("work/paper");
    let link = fixture.temp.path().join("work").join("link");
    make_junction(&link, &target);
    assert_eq!(
        register_or_resolve_folder(&link).unwrap().project_id,
        register_or_resolve_folder(&target).unwrap().project_id
    );
}

fn link_research_folder(project_id: &str, folder: &Path, access: ResearchRootAccess) {
    roots::add_root(AddResearchRootRequest {
        project_id: project_id.into(),
        path: text(folder),
        label: "Data".into(),
        role: ResearchRootRole::Data,
        access,
    })
    .unwrap();
}

#[test]
fn a_folder_another_project_can_write_to_is_not_opened_as_a_second_project() {
    let fixture = Fixture::new();
    library_project("survey", "Survey");
    let shared = fixture.folder("work/outer/shared");
    let raw = fixture.folder("work/outer/shared/raw");
    link_research_folder("survey", &shared, ResearchRootAccess::ReadWrite);
    for candidate in [shared, raw, fixture.folder("work/outer")] {
        match register_or_resolve_folder(&candidate) {
            Err(OpenFolderError::WritableResearchRoot {
                project_id,
                project_name,
                ..
            }) => {
                assert_eq!(
                    (project_id.as_str(), project_name.as_str()),
                    ("survey", "Survey")
                );
            }
            other => panic!("{candidate:?}: {other:?}"),
        }
    }
    assert!(records().is_empty());
}

#[test]
fn a_read_only_research_folder_can_still_be_opened() {
    let fixture = Fixture::new();
    library_project("survey", "Survey");
    let shared = fixture.folder("work/shared");
    link_research_folder("survey", &shared, ResearchRootAccess::ReadOnly);
    assert_eq!(
        register_or_resolve_folder(&shared).unwrap().outcome,
        FolderOutcome::New
    );
}

#[test]
fn a_registered_folder_stays_openable_after_its_research_link_changes() {
    let fixture = Fixture::new();
    library_project("survey", "Survey");
    let shared = fixture.folder("work/shared");
    let opened = register_or_resolve_folder(&shared).unwrap();
    link_research_folder("survey", &shared, ResearchRootAccess::ReadOnly);
    let again = register_or_resolve_folder(&shared).unwrap();
    assert_eq!(
        (again.project_id, again.outcome),
        (opened.project_id, FolderOutcome::Existing)
    );
}

#[test]
fn a_folder_replaced_at_the_same_path_gets_a_new_id_and_a_reattach_offer() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let original = register_or_resolve_folder(&paper).unwrap();
    std::fs::rename(&paper, fixture.temp.path().join("work/old")).unwrap();
    std::fs::create_dir(&paper).unwrap();
    let replaced = register_or_resolve_folder(&paper).unwrap();
    assert_ne!(replaced.project_id, original.project_id);
    assert_eq!(
        replaced.outcome,
        FolderOutcome::Replaced {
            displaced: original.project_id.clone()
        }
    );
    let offer = replaced.reattach.clone().unwrap();
    assert_eq!(
        (offer.from_id.as_str(), offer.reason),
        (original.project_id.as_str(), ReattachReason::Replaced)
    );
    assert_eq!(pending_reattach(&replaced.project_id).unwrap(), Some(offer));
    dismiss_reattach(&replaced.project_id).unwrap();
    assert_eq!(pending_reattach(&replaced.project_id).unwrap(), None);
    assert_eq!(
        register_or_resolve_folder(&paper).unwrap().outcome,
        FolderOutcome::Existing
    );
}

#[cfg(unix)]
#[test]
fn a_replacement_that_cannot_mark_the_old_record_registers_nothing() {
    use std::os::unix::fs::PermissionsExt as _;
    if unsafe { libc::geteuid() } == 0 {
        eprintln!("skipping: root ignores folder permissions");
        return;
    }
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let original = register_or_resolve_folder(&paper).unwrap().project_id;
    std::fs::rename(&paper, fixture.temp.path().join("work/old")).unwrap();
    std::fs::create_dir(&paper).unwrap();
    let linked_root = crate::paths::linked_root().unwrap();
    let entry = linked_root.join(&original);
    std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o500)).unwrap();
    let result = register_or_resolve_folder(&paper);
    std::fs::set_permissions(&entry, std::fs::Permissions::from_mode(0o700)).unwrap();
    assert!(
        matches!(result, Err(OpenFolderError::Failed(_))),
        "{result:?}"
    );
    let entries: Vec<String> = std::fs::read_dir(&linked_root)
        .unwrap()
        .flatten()
        .filter_map(|entry| entry.file_name().to_str().map(str::to_string))
        .filter(|name| crate::linked_registry::is_linked_id(name))
        .collect();
    assert_eq!(entries, std::slice::from_ref(&original));
    let records = records();
    assert_eq!(records.len(), 1);
    assert!(records[0].is_current());
    let replaced = register_or_resolve_folder(&paper).unwrap();
    assert_eq!(
        replaced.outcome,
        FolderOutcome::Replaced {
            displaced: original.clone()
        }
    );
    assert_eq!(
        pending_reattach(&replaced.project_id)
            .unwrap()
            .map(|offer| offer.from_id),
        Some(original)
    );
}

#[test]
fn refusals_name_a_linked_project_the_way_the_library_does() {
    let fixture = Fixture::new();
    let survey = fixture.folder("work/survey");
    let owner = register_or_resolve_folder(&survey).unwrap().project_id;
    let shared = fixture.folder("work/shared");
    link_research_folder(&owner, &shared, ResearchRootAccess::ReadWrite);
    let research_owner = || match register_or_resolve_folder(&shared) {
        Err(OpenFolderError::WritableResearchRoot {
            project_id,
            project_name,
            ..
        }) => {
            assert_eq!(project_id, owner);
            project_name
        }
        other => panic!("{other:?}"),
    };
    assert_eq!(research_owner(), "survey");
    let manifest = crate::project_location::linked_state_dir(&owner)
        .unwrap()
        .unwrap()
        .join(crate::project_location::MANIFEST_FILE);
    std::fs::write(&manifest, r#"{"name":"Field survey"}"#).unwrap();
    assert_eq!(research_owner(), "Field survey");
    crate::linked_registry::update(&owner, |record| {
        record.display_name = Some("Survey 2026".into());
        Ok(())
    })
    .unwrap();
    assert_eq!(research_owner(), "Survey 2026");
    let paper = fixture.folder("work/thesis/paper");
    let child = register_or_resolve_folder(&paper).unwrap().project_id;
    crate::linked_registry::update(&child, |record| {
        record.display_name = Some("Thesis draft".into());
        Ok(())
    })
    .unwrap();
    assert_eq!(
        register_or_resolve_folder(&fixture.folder("work/thesis")),
        Err(OpenFolderError::ContainsProjects {
            children: vec![OverlapChild {
                id: child,
                name: "Thesis draft".into(),
                relative_path: "paper".into()
            }]
        })
    );
}

#[test]
fn a_replaced_folder_reopened_elsewhere_gets_its_old_id_back() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let original = register_or_resolve_folder(&paper).unwrap();
    std::fs::rename(&paper, fixture.temp.path().join("work/old")).unwrap();
    std::fs::create_dir(&paper).unwrap();
    let replaced = register_or_resolve_folder(&paper).unwrap();
    if !has_birth_time() {
        eprintln!("skipping: this filesystem reports no birth time");
        return;
    }
    let old = fixture.temp.path().join("work/old").canonicalize().unwrap();
    let back = register_or_resolve_folder(&old).unwrap();
    assert_eq!(back.project_id, original.project_id);
    assert_eq!(back.outcome, FolderOutcome::Moved { from: text(&paper) });
    assert_eq!(pending_reattach(&replaced.project_id).unwrap(), None);
}

#[test]
fn a_removed_folder_reopened_comes_back_under_its_old_id() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let original = register_or_resolve_folder(&paper).unwrap();
    crate::linked_registry::update(&original.project_id, |record| {
        record.removed_at = Some(1);
        Ok(())
    })
    .unwrap();
    let revived = register_or_resolve_folder(&paper).unwrap();
    assert_eq!(revived.project_id, original.project_id);
    assert_eq!(
        revived.outcome,
        FolderOutcome::Revived { from: text(&paper) }
    );
    assert_eq!(records()[0].removed_at, None);
}

#[test]
fn a_different_folder_at_a_removed_path_offers_to_reattach_the_removed_project() {
    let fixture = Fixture::new();
    let paper = fixture.folder("work/paper");
    let original = register_or_resolve_folder(&paper).unwrap();
    crate::linked_registry::update(&original.project_id, |record| {
        record.removed_at = Some(1);
        Ok(())
    })
    .unwrap();
    std::fs::rename(&paper, fixture.temp.path().join("work/old")).unwrap();
    std::fs::create_dir(&paper).unwrap();
    let newcomer = register_or_resolve_folder(&paper).unwrap();
    assert_eq!(newcomer.outcome, FolderOutcome::New);
    let offer = newcomer.reattach.unwrap();
    assert_eq!(
        (offer.from_id.as_str(), offer.reason),
        (original.project_id.as_str(), ReattachReason::Removed)
    );
    assert_eq!(pending_reattach(&newcomer.project_id).unwrap(), Some(offer));
}

#[test]
fn every_refusal_has_an_english_message_with_its_placeholders() {
    let catalog: serde_json::Value =
        serde_json::from_str(include_str!("../../../src/i18n/locales/en/errors.json")).unwrap();
    let refusals = [
        OpenFolderError::NotAbsolute,
        OpenFolderError::NotFound,
        OpenFolderError::PermissionDenied,
        OpenFolderError::NotAFolder,
        OpenFolderError::UnsupportedLink,
        OpenFolderError::NotUnicode,
        OpenFolderError::TooBroad {
            name: "Documents".into(),
        },
        OpenFolderError::Protected {
            name: "System".into(),
        },
        OpenFolderError::AppData,
        OpenFolderError::ContainsProjects {
            children: vec![OverlapChild {
                id: "linked-a".into(),
                name: "paper".into(),
                relative_path: "paper".into(),
            }],
        },
        OpenFolderError::WritableResearchRoot {
            project_id: "survey".into(),
            root_id: "root-a".into(),
            project_name: "Survey".into(),
        },
        OpenFolderError::Failed("disk error".into()),
    ];
    let mut codes = std::collections::BTreeSet::new();
    for refusal in refusals {
        let error = refusal.app_error();
        let node = error
            .code
            .split('.')
            .fold(&catalog, |node, segment| &node[segment]);
        let message = node
            .as_str()
            .unwrap_or_else(|| panic!("{} has no English message", error.code));
        for name in error.params.keys() {
            assert!(
                message.contains(&format!("{{{{{name}}}}}")),
                "{} lacks {{{{{name}}}}}",
                error.code
            );
        }
        codes.insert(error.code);
    }
    assert_eq!(codes.len(), 12);
    let text: String = OpenFolderError::TooBroad {
        name: "Documents".into(),
    }
    .into();
    assert!(
        text.contains("\"code\":\"open_folder.too_broad\""),
        "{text}"
    );
    assert!(catalog["research"]["linked_project_folder"].is_string());
}
