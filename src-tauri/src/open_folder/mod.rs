pub(crate) mod matching;
#[cfg(test)]
mod tests;

use crate::app_error::AppError;
use crate::fs_identity::{CaseSensitivity, FsIdentity, IdentityMatch, VolumeKind};
use crate::known_folders::{FolderScope, KnownFolders};
use crate::linked_registry::{
    Displacement, LinkRecord, NewLink, ReattachOffer, ReattachReason, Transaction,
};
use crate::paths::ReparseClass;
use crate::research_workspace::roots::WritableRootOverlap;
use matching::{Candidate, Decision, OverlapChild, RootProbe, RootState};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OpenFolderError {
    NotAbsolute,
    NotFound,
    PermissionDenied,
    NotAFolder,
    UnsupportedLink,
    NotUnicode,
    TooBroad {
        name: String,
    },
    Protected {
        name: String,
    },
    AppData,
    ContainsProjects {
        children: Vec<OverlapChild>,
    },
    WritableResearchRoot {
        project_id: String,
        root_id: String,
        project_name: String,
    },
    Failed(String),
}

impl OpenFolderError {
    pub(crate) fn app_error(&self) -> AppError {
        match self {
            Self::NotAbsolute => AppError::new("open_folder.not_absolute"),
            Self::NotFound => AppError::new("open_folder.not_found"),
            Self::PermissionDenied => AppError::new("open_folder.permission_denied"),
            Self::NotAFolder => AppError::new("open_folder.not_a_folder"),
            Self::UnsupportedLink => AppError::new("open_folder.unsupported_folder"),
            Self::NotUnicode => AppError::new("open_folder.path_not_unicode"),
            Self::TooBroad { name } => AppError::new("open_folder.too_broad").param("name", name),
            Self::Protected { name } => AppError::new("open_folder.protected").param("name", name),
            Self::AppData => AppError::new("open_folder.app_data"),
            Self::ContainsProjects { children } => AppError::new("open_folder.contains_project")
                .param(
                    "name",
                    children
                        .first()
                        .map(|child| child.name.as_str())
                        .unwrap_or_default(),
                ),
            Self::WritableResearchRoot { project_name, .. } => {
                AppError::new("open_folder.research_folder").param("project", project_name)
            }
            Self::Failed(detail) => AppError::new("open_folder.failed").detail(detail),
        }
    }
}

impl From<OpenFolderError> for String {
    fn from(error: OpenFolderError) -> Self {
        error.app_error().into()
    }
}

impl From<String> for OpenFolderError {
    fn from(detail: String) -> Self {
        Self::Failed(detail)
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct InspectedFolder {
    pub(crate) canonical: PathBuf,
    pub(crate) canonical_text: String,
    pub(crate) identity: FsIdentity,
    pub(crate) volume_kind: VolumeKind,
    pub(crate) case: CaseSensitivity,
    pub(crate) reparse: ReparseClass,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Inspection {
    Library {
        project_id: String,
        reveal: Option<String>,
    },
    Folder(InspectedFolder),
}

pub(crate) fn inspect_folder(requested: &Path) -> Result<Inspection, OpenFolderError> {
    inspect_folder_with(requested, &KnownFolders::current())
}

fn inspect_folder_with(
    requested: &Path,
    known: &KnownFolders,
) -> Result<Inspection, OpenFolderError> {
    if !requested.is_absolute() {
        return Err(OpenFolderError::NotAbsolute);
    }
    std::fs::symlink_metadata(requested).map_err(io_refusal)?;
    let canonical = requested.canonicalize().map_err(io_refusal)?;
    let metadata = std::fs::symlink_metadata(&canonical).map_err(io_refusal)?;
    if metadata.file_type().is_symlink() {
        return Err(OpenFolderError::UnsupportedLink);
    }
    if !metadata.is_dir() {
        return Err(OpenFolderError::NotAFolder);
    }
    let reparse = if crate::paths::is_reparse_point(&metadata) {
        crate::paths::reparse_class(&canonical).map_err(io_refusal)?
    } else {
        ReparseClass::None
    };
    if !reparse.opens_as_folder() {
        return Err(OpenFolderError::UnsupportedLink);
    }
    let canonical_text = canonical
        .to_str()
        .ok_or(OpenFolderError::NotUnicode)?
        .to_string();
    if let Some(library) = library_placement(&canonical)? {
        return Ok(library);
    }
    match crate::known_folders::scope_of(&canonical, known) {
        FolderScope::Narrow => {}
        FolderScope::Broad => {
            return Err(OpenFolderError::TooBroad {
                name: display_name(&canonical),
            })
        }
        FolderScope::AppData => return Err(OpenFolderError::AppData),
        FolderScope::Protected(root) => {
            return Err(OpenFolderError::Protected {
                name: display_name(&root),
            })
        }
    }
    let observed = crate::fs_identity::identify_directory(&canonical).map_err(io_refusal)?;
    Ok(Inspection::Folder(InspectedFolder {
        canonical,
        canonical_text,
        identity: observed.identity,
        volume_kind: observed.volume_kind,
        case: observed.case,
        reparse,
    }))
}

fn library_placement(canonical: &Path) -> Result<Option<Inspection>, OpenFolderError> {
    let library = match crate::paths::oleafly_root()?
        .join("projects")
        .canonicalize()
    {
        Ok(library) => library,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_refusal(error)),
    };
    let Ok(rest) = canonical.strip_prefix(&library) else {
        return Ok(None);
    };
    let mut components = rest.components();
    let project_id = match components.next() {
        Some(Component::Normal(first)) => first.to_str(),
        _ => None,
    }
    .filter(|id| {
        crate::paths::validate_project_id(id).is_ok() && *id != crate::project::SCRATCH_PROJECT_ID
    })
    .ok_or(OpenFolderError::AppData)?;
    if !matches!(crate::paths::library_project_root(project_id), Ok(Some(_))) {
        return Err(OpenFolderError::AppData);
    }
    Ok(Some(Inspection::Library {
        project_id: project_id.to_string(),
        reveal: reveal_path(components.as_path()),
    }))
}

fn reveal_path(rest: &Path) -> Option<String> {
    let mut parts = Vec::new();
    for component in rest.components() {
        let Component::Normal(part) = component else {
            return None;
        };
        parts.push(part.to_str()?);
    }
    match parts.first() {
        None | Some(&".git") | Some(&".oleafly") => None,
        Some(_) => Some(parts.join("/")),
    }
}

fn display_name(path: &Path) -> String {
    match path.file_name() {
        Some(name) => name.to_string_lossy().into_owned(),
        None => crate::project_availability::without_verbatim_prefix(path)
            .to_string_lossy()
            .into_owned(),
    }
}

fn io_refusal(error: std::io::Error) -> OpenFolderError {
    match error.kind() {
        std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory => {
            OpenFolderError::NotFound
        }
        std::io::ErrorKind::PermissionDenied => OpenFolderError::PermissionDenied,
        _ => OpenFolderError::Failed(error.to_string()),
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum OpenedKind {
    Library,
    Linked,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum FolderOutcome {
    Library,
    Existing,
    New,
    Moved { from: String },
    Remounted { from: String },
    Revived { from: String },
    Replaced { displaced: String },
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct OpenedFolder {
    pub(crate) project_id: String,
    pub(crate) kind: OpenedKind,
    pub(crate) reveal: Option<String>,
    pub(crate) outcome: FolderOutcome,
    pub(crate) reattach: Option<ReattachOffer>,
}

impl OpenedFolder {
    fn library(project_id: String, reveal: Option<String>) -> Self {
        Self {
            project_id,
            kind: OpenedKind::Library,
            reveal,
            outcome: FolderOutcome::Library,
            reattach: None,
        }
    }

    fn linked(
        project_id: String,
        reveal: Option<String>,
        outcome: FolderOutcome,
        reattach: Option<ReattachOffer>,
    ) -> Self {
        Self {
            project_id,
            kind: OpenedKind::Linked,
            reveal,
            outcome,
            reattach,
        }
    }
}

struct DiskProbe;

impl RootProbe for DiskProbe {
    fn root_state(&self, record: &LinkRecord) -> RootState {
        let path = Path::new(&record.canonical_path);
        match std::fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() && !metadata.file_type().is_symlink() => {}
            Ok(_) => return RootState::Different,
            Err(_) => return RootState::Missing,
        }
        if record.identity.weak {
            return RootState::Present;
        }
        match crate::fs_identity::identify_directory(path) {
            Ok(observed)
                if crate::fs_identity::compare(&record.identity, &observed.identity)
                    != IdentityMatch::Different =>
            {
                RootState::Present
            }
            Ok(_) => RootState::Different,
            Err(_) => RootState::Missing,
        }
    }

    fn remount_verified(&self, record: &LinkRecord, candidate: &Path) -> bool {
        match recorded_main_document(&record.id) {
            Some(main) => {
                crate::sandbox::resolve_within(candidate, &main).is_ok_and(|path| path.is_file())
            }
            None => true,
        }
    }
}

fn recorded_main_document(project_id: &str) -> Option<String> {
    let sidecar = crate::paths::existing_linked_root()
        .ok()??
        .join(project_id)
        .join(crate::project_location::MANIFEST_FILE);
    let bytes = std::fs::read(sidecar).ok()?;
    let manifest: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    manifest.get("main_doc")?.as_str().map(str::to_string)
}

pub(crate) fn register_or_resolve_folder(
    requested: &Path,
) -> Result<OpenedFolder, OpenFolderError> {
    register_or_resolve_folder_with(requested, &KnownFolders::current(), &DiskProbe)
}

fn register_or_resolve_folder_with(
    requested: &Path,
    known: &KnownFolders,
    probe: &dyn RootProbe,
) -> Result<OpenedFolder, OpenFolderError> {
    let folder = match inspect_folder_with(requested, known)? {
        Inspection::Library { project_id, reveal } => {
            return Ok(OpenedFolder::library(project_id, reveal))
        }
        Inspection::Folder(folder) => folder,
    };
    let research = crate::research_workspace::roots::writable_roots_overlapping(
        &folder.canonical,
        folder.case,
    )?;
    crate::linked_registry::transaction(|txn| {
        let candidate = Candidate {
            path: &folder.canonical,
            identity: &folder.identity,
            case: folder.case,
        };
        let decision = matching::decide(&candidate, txn.records(), probe);
        apply(txn, &folder, decision, research.first())
    })
    .map_err(name_projects)
}

fn name_projects(error: OpenFolderError) -> OpenFolderError {
    match error {
        OpenFolderError::WritableResearchRoot {
            project_id,
            root_id,
            ..
        } => OpenFolderError::WritableResearchRoot {
            project_name: project_name(&project_id),
            project_id,
            root_id,
        },
        OpenFolderError::ContainsProjects { children } => OpenFolderError::ContainsProjects {
            children: children
                .into_iter()
                .map(|child| OverlapChild {
                    name: linked_project_name(&child.id).unwrap_or(child.name),
                    ..child
                })
                .collect(),
        },
        other => other,
    }
}

fn project_name(project_id: &str) -> String {
    linked_project_name(project_id).unwrap_or_else(|| {
        crate::project::read_meta(project_id)
            .map(|meta| meta.name)
            .ok()
            .filter(|name| !name.trim().is_empty())
            .unwrap_or_else(|| project_id.to_string())
    })
}

fn linked_project_name(project_id: &str) -> Option<String> {
    let record = crate::linked_registry::get(project_id).ok()??;
    Some(crate::project::linked_display_name(
        &record,
        crate::project::linked_listing_meta(project_id).as_ref(),
    ))
}

fn apply(
    txn: &mut Transaction,
    folder: &InspectedFolder,
    decision: Decision,
    research: Option<&WritableRootOverlap>,
) -> Result<OpenedFolder, OpenFolderError> {
    let registers = !matches!(
        decision,
        Decision::Existing { .. } | Decision::Inside { .. } | Decision::Overlap { .. }
    );
    if let (true, Some(overlap)) = (registers, research) {
        return Err(OpenFolderError::WritableResearchRoot {
            project_id: overlap.project_id.clone(),
            root_id: overlap.root_id.clone(),
            project_name: String::new(),
        });
    }
    let now = now_ms();
    match decision {
        Decision::Inside { id, reveal } => {
            let reattach = live_offer(&id, txn.records());
            Ok(OpenedFolder::linked(
                id,
                reveal,
                FolderOutcome::Existing,
                reattach,
            ))
        }
        Decision::Existing { id } => {
            txn.update(&id, |record| {
                record.canonical_path.clone_from(&folder.canonical_text);
                Ok(())
            })?;
            let reattach = live_offer(&id, txn.records());
            Ok(OpenedFolder::linked(
                id,
                None,
                FolderOutcome::Existing,
                reattach,
            ))
        }
        Decision::Overlap { children } => Err(OpenFolderError::ContainsProjects { children }),
        Decision::Moved { id, from } => relink(txn, folder, id, FolderOutcome::Moved { from }, now),
        Decision::Remounted { id, from } => {
            relink(txn, folder, id, FolderOutcome::Remounted { from }, now)
        }
        Decision::Revived { id, from } => {
            relink(txn, folder, id, FolderOutcome::Revived { from }, now)
        }
        Decision::Replace { displaced } => {
            let offer = ReattachOffer {
                from_id: displaced.clone(),
                reason: ReattachReason::Replaced,
                offered_at_ms: now,
            };
            let created =
                txn.create_with(new_link(folder), Some(offer.clone()), |txn, created| {
                    txn.update(&displaced, |record| {
                        record.displaced = Some(Displacement {
                            by: created.id.clone(),
                            at_ms: now,
                        });
                        Ok(())
                    })
                    .map(|_| ())
                })?;
            Ok(OpenedFolder::linked(
                created.id,
                None,
                FolderOutcome::Replaced { displaced },
                Some(offer),
            ))
        }
        Decision::New {
            removed_predecessor,
        } => {
            let offer = removed_predecessor.map(|from_id| ReattachOffer {
                from_id,
                reason: ReattachReason::Removed,
                offered_at_ms: now,
            });
            let created = txn.create(new_link(folder), offer.clone())?;
            Ok(OpenedFolder::linked(
                created.id,
                None,
                FolderOutcome::New,
                offer,
            ))
        }
    }
}

fn relink(
    txn: &mut Transaction,
    folder: &InspectedFolder,
    id: String,
    outcome: FolderOutcome,
    now: u64,
) -> Result<OpenedFolder, OpenFolderError> {
    let others: Vec<String> = txn
        .records()
        .iter()
        .filter(|record| record.id != id && record.is_current())
        .filter(|record| {
            crate::fs_identity::same_path(
                Path::new(&record.canonical_path),
                &folder.canonical,
                folder.case,
            )
        })
        .map(|record| record.id.clone())
        .collect();
    for other in others {
        txn.update(&other, |record| {
            record.displaced = Some(Displacement {
                by: id.clone(),
                at_ms: now,
            });
            Ok(())
        })?;
    }
    txn.update(&id, |record| {
        record.canonical_path.clone_from(&folder.canonical_text);
        record.identity = folder.identity.clone();
        record.volume_kind = folder.volume_kind;
        record.removed_at = None;
        record.displaced = None;
        Ok(())
    })?;
    let reattach = live_offer(&id, txn.records());
    Ok(OpenedFolder::linked(id, None, outcome, reattach))
}

fn new_link(folder: &InspectedFolder) -> NewLink {
    NewLink {
        canonical_path: folder.canonical.clone(),
        identity: folder.identity.clone(),
        volume_kind: folder.volume_kind,
        display_name: None,
    }
}

pub(crate) fn pending_reattach(project_id: &str) -> Result<Option<ReattachOffer>, String> {
    let records: Vec<LinkRecord> = crate::linked_registry::list()?
        .into_iter()
        .filter_map(|entry| match entry {
            crate::linked_registry::LinkEntry::Record(record) => Some(*record),
            crate::linked_registry::LinkEntry::Corrupt { .. } => None,
        })
        .collect();
    Ok(live_offer(project_id, &records))
}

pub(crate) fn dismiss_reattach(project_id: &str) -> Result<(), String> {
    crate::linked_registry::update(project_id, |record| {
        record.reattach = None;
        Ok(())
    })
    .map(|_| ())
}

fn live_offer(project_id: &str, records: &[LinkRecord]) -> Option<ReattachOffer> {
    let offer = records
        .iter()
        .find(|record| record.id == project_id)?
        .reattach
        .clone()?;
    let predecessor = records.iter().find(|record| record.id == offer.from_id)?;
    (predecessor.displaced.is_some() || predecessor.removed_at.is_some()).then_some(offer)
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
