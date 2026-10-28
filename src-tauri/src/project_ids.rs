use oleafly_core::content::{tree_digest, ContentHash};
use oleafly_core::exclude::{decide_with_siblings, Decision, EntryInfo, EntryKind, PolicyFields};
use oleafly_core::ids::ProjectId;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_BINDINGS_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ORIGIN_FILES: usize = 100_000;

static BINDINGS_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectBinding {
    pub project: ProjectId,
    #[serde(default)]
    pub duplicated_from: Option<ProjectId>,
    pub created: String,
    #[serde(default)]
    pub origin_digest: Option<String>,
    #[serde(default)]
    pub cloud: BTreeMap<String, ProjectId>,
}

type Bindings = BTreeMap<String, ProjectBinding>;

struct StoreLock {
    _file: std::fs::File,
    _guard: MutexGuard<'static, ()>,
}

pub(crate) fn store_path() -> Result<PathBuf, String> {
    Ok(crate::paths::oleafly_root()?.join("project-ids.json"))
}

fn lock_store(path: &Path) -> Result<StoreLock, String> {
    let guard = oleafly_core::locking::lock_mutex(
        BINDINGS_LOCK.get_or_init(|| Mutex::new(())),
        oleafly_core::locking::STORAGE_LOCK_TIMEOUT,
    )
    .map_err(|error| format!("failed to lock project identity store: {error}"))?;
    let parent = path
        .parent()
        .ok_or_else(|| "project identity store path has no parent directory".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("failed to create project identity store directory: {error}"))?;
    let lock_path = parent.join(".project-ids.lock");
    let file = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(&lock_path)
        .map_err(|error| format!("failed to open project identity store lock: {error}"))?;
    oleafly_core::locking::lock_file(&file, true, oleafly_core::locking::STORAGE_LOCK_TIMEOUT)
        .map_err(|error| format!("failed to lock project identity store: {error}"))?;
    Ok(StoreLock {
        _file: file,
        _guard: guard,
    })
}

fn read_bindings_at(path: &Path) -> Result<Bindings, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Bindings::new()),
        Err(error) => return Err(format!("failed to read project identity store: {error}")),
    };
    let mut bytes = Vec::new();
    file.take(MAX_BINDINGS_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| format!("failed to read project identity store: {error}"))?;
    if bytes.len() as u64 > MAX_BINDINGS_BYTES {
        return Err("project identity store is too large".into());
    }
    if bytes.iter().all(u8::is_ascii_whitespace) {
        return Ok(Bindings::new());
    }
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("project identity store is unreadable: {error}"))
}

fn write_bindings_at(path: &Path, bindings: &Bindings) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(bindings)
        .map_err(|error| format!("failed to encode project identity store: {error}"))?;
    crate::sandbox::atomic_write(path, &bytes)
}

fn update_at<T>(
    path: &Path,
    change: impl FnOnce(&mut Bindings) -> Result<T, String>,
) -> Result<T, String> {
    let _lock = lock_store(path)?;
    let before = read_bindings_at(path)?;
    let mut bindings = before.clone();
    let value = change(&mut bindings)?;
    if bindings != before {
        write_bindings_at(path, &bindings)?;
    }
    Ok(value)
}

fn read_at<T>(path: &Path, read: impl FnOnce(&Bindings) -> T) -> Result<T, String> {
    let _lock = lock_store(path)?;
    let bindings = read_bindings_at(path)?;
    Ok(read(&bindings))
}

pub fn binding(local_id: &str) -> Result<Option<ProjectBinding>, String> {
    let path = store_path()?;
    read_at(&path, |bindings| bindings.get(local_id).cloned())
}

pub fn all_bindings() -> Result<BTreeMap<String, ProjectBinding>, String> {
    let path = store_path()?;
    read_at(&path, Clone::clone)
}

fn mint_at(
    path: &Path,
    local_id: &str,
    adopted: Option<ProjectId>,
    created: String,
) -> Result<ProjectBinding, String> {
    update_at(path, |bindings| {
        if let Some(existing) = bindings.get(local_id) {
            return Ok(existing.clone());
        }
        let project = adopted.unwrap_or_default();
        if let Some((other, _)) = bindings
            .iter()
            .find(|(_, binding)| binding.project == project)
        {
            if adopted.is_some() {
                return Err(format!("project identity is already bound to {other}"));
            }
            return Err("could not allocate a unique project identity".into());
        }
        let binding = ProjectBinding {
            project,
            duplicated_from: None,
            created,
            origin_digest: None,
            cloud: BTreeMap::new(),
        };
        bindings.insert(local_id.to_string(), binding.clone());
        Ok(binding)
    })
}

pub fn mint(local_id: &str, adopted: Option<ProjectId>) -> Result<ProjectBinding, String> {
    let path = store_path()?;
    mint_at(&path, local_id, adopted, rfc3339_now())
}

fn set_duplicated_from_at(path: &Path, local_id: &str, source: ProjectId) -> Result<(), String> {
    update_at(path, |bindings| {
        let binding = bindings
            .get_mut(local_id)
            .ok_or_else(|| format!("project {local_id} has no identity binding"))?;
        binding.duplicated_from = Some(source);
        Ok(())
    })
}

pub fn set_duplicated_from(local_id: &str, source: ProjectId) -> Result<(), String> {
    let path = store_path()?;
    set_duplicated_from_at(&path, local_id, source)
}

fn set_origin_at(path: &Path, local_id: &str, digest: ContentHash) -> Result<(), String> {
    update_at(path, |bindings| {
        let binding = bindings
            .get_mut(local_id)
            .ok_or_else(|| format!("project {local_id} has no identity binding"))?;
        binding.origin_digest = Some(digest.to_hex());
        Ok(())
    })
}

pub fn finalize_origin(local_id: &str, root: &Path) -> Result<(), String> {
    let path = store_path()?;
    finalize_origin_at(&path, local_id, root)
}

pub(crate) fn finalize_origin_at(store: &Path, local_id: &str, root: &Path) -> Result<(), String> {
    let digest = origin_digest(root)?;
    set_origin_at(store, local_id, digest)
}

pub(crate) fn mint_in(
    store: &Path,
    local_id: &str,
    adopted: Option<ProjectId>,
) -> Result<ProjectBinding, String> {
    mint_at(store, local_id, adopted, rfc3339_now())
}

pub fn ensure(local_id: &str, root: &Path) -> Result<ProjectBinding, String> {
    if let Some(existing) = binding(local_id)?.filter(|binding| binding.origin_digest.is_some()) {
        return Ok(existing);
    }
    let binding = mint(local_id, None)?;
    if binding.origin_digest.is_some() {
        return Ok(binding);
    }
    if let Err(error) = finalize_origin(local_id, root) {
        let _ = crate::project::append_app_log(format!(
            "could not record the origin of project {local_id}: {error}"
        ));
        return Ok(binding);
    }
    self::binding(local_id)?.ok_or_else(|| format!("project {local_id} has no identity binding"))
}

pub(crate) fn forget_at(path: &Path, local_id: &str) -> Result<(), String> {
    update_at(path, |bindings| {
        bindings.remove(local_id);
        Ok(())
    })
}

pub fn forget(local_id: &str) -> Result<(), String> {
    let path = store_path()?;
    forget_at(&path, local_id)
}

fn set_cloud_at(
    path: &Path,
    local_id: &str,
    account_id: &str,
    cloud: Option<ProjectId>,
) -> Result<(), String> {
    update_at(path, |bindings| {
        let binding = bindings
            .get_mut(local_id)
            .ok_or_else(|| format!("project {local_id} has no identity binding"))?;
        match cloud {
            Some(project) => {
                binding.cloud.insert(account_id.to_string(), project);
            }
            None => {
                binding.cloud.remove(account_id);
            }
        }
        Ok(())
    })
}

fn bound_local_id_at(path: &Path, project: ProjectId) -> Result<Option<String>, String> {
    read_at(path, |bindings| {
        bindings
            .iter()
            .find(|(_, binding)| {
                binding.project == project || binding.cloud.values().any(|cloud| *cloud == project)
            })
            .map(|(local_id, _)| local_id.clone())
    })
}

pub fn bound_local_id(project: ProjectId) -> Result<Option<String>, String> {
    bound_local_id_at(&store_path()?, project)
}

pub fn set_cloud(local_id: &str, account_id: &str, cloud: Option<ProjectId>) -> Result<(), String> {
    let path = store_path()?;
    set_cloud_at(&path, local_id, account_id, cloud)
}

pub fn origin_digest(root: &Path) -> Result<ContentHash, String> {
    let manifest = read_manifest_fields(root);
    let fields = PolicyFields {
        main_doc: &manifest.main_doc,
        sync_include: &manifest.sync_include,
        sync_exclude: &manifest.sync_exclude,
    };
    let mut entries = Vec::new();
    std::fs::read_dir(root)
        .map_err(|error| format!("failed to read project directory: {error}"))?;
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let Ok(read) = std::fs::read_dir(&directory) else {
            continue;
        };
        let mut children: Vec<_> = read.flatten().collect();
        children.sort_by_key(std::fs::DirEntry::file_name);
        for entry in children {
            if let Some(file) = origin_entry(root, &entry, &fields, &mut pending) {
                entries.push(file);
                if entries.len() > MAX_ORIGIN_FILES {
                    return Err("project has too many files for an origin digest".into());
                }
            }
        }
    }
    Ok(tree_digest(&entries))
}

fn origin_entry(
    root: &Path,
    entry: &std::fs::DirEntry,
    fields: &PolicyFields<'_>,
    pending: &mut Vec<PathBuf>,
) -> Option<(String, ContentHash, bool)> {
    let file_type = entry.file_type().ok()?;
    let path = entry.path();
    let relative = path.strip_prefix(root).ok()?;
    let kind = if file_type.is_symlink() {
        EntryKind::Symlink
    } else if file_type.is_dir() {
        EntryKind::Directory
    } else if file_type.is_file() {
        EntryKind::File
    } else {
        EntryKind::Other
    };
    let metadata = entry.metadata().ok()?;
    let info = EntryInfo {
        kind,
        len: metadata.len(),
        placeholder: oleafly_core::is_cloud_placeholder(&metadata),
        git_tracked: false,
        git_pointer_inside: None,
    };
    if decide_with_siblings(relative, &info, fields, |sibling| {
        root.join(sibling).is_file()
    }) != Decision::Include
    {
        return None;
    }
    if kind == EntryKind::Directory {
        pending.push(path);
        return None;
    }
    let portable = portable_path(relative)?;
    let hash = crate::checkpoint_capture::cached_capture_hash(&path, &portable, &metadata).ok()?;
    Some((portable, hash, is_executable(&metadata)))
}

fn read_manifest_fields(root: &Path) -> oleafly_core::ProjectManifest {
    let path = root.join("project.json");
    let Ok(metadata) = std::fs::metadata(&path) else {
        return oleafly_core::ProjectManifest::default();
    };
    if !metadata.is_file() || metadata.len() > oleafly_core::MAX_MANIFEST_BYTES {
        return oleafly_core::ProjectManifest::default();
    }
    std::fs::read(&path)
        .ok()
        .and_then(|bytes| oleafly_core::sniff_oleafly_manifest(&bytes))
        .unwrap_or_default()
}

fn portable_path(relative: &Path) -> Option<String> {
    let mut portable = String::new();
    for component in relative.components() {
        let std::path::Component::Normal(part) = component else {
            return None;
        };
        let part = part.to_str()?;
        if !portable.is_empty() {
            portable.push('/');
        }
        portable.push_str(part);
    }
    (!portable.is_empty()).then_some(portable)
}

#[cfg(unix)]
fn is_executable(metadata: &std::fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt as _;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &std::fs::Metadata) -> bool {
    false
}

pub fn rfc3339_from_unix_ms(ms: u64) -> String {
    let days = (ms / 86_400_000) as i64;
    let day_ms = ms % 86_400_000;
    let (year, month, day) = civil_from_days(days);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        day_ms / 3_600_000,
        (day_ms / 60_000) % 60,
        (day_ms / 1_000) % 60,
        day_ms % 1_000
    )
}

#[cfg(test)]
pub fn unix_ms_from_rfc3339(value: &str) -> Option<u64> {
    let bytes = value.as_bytes();
    if bytes.len() != 24
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'.'
        || bytes[23] != b'Z'
    {
        return None;
    }
    let number = |from: usize, to: usize| value[from..to].parse::<i64>().ok();
    let year = number(0, 4)?;
    let month = number(5, 7)?;
    let day = number(8, 10)?;
    let hour = number(11, 13)?;
    let minute = number(14, 16)?;
    let second = number(17, 19)?;
    let milli = number(20, 23)?;
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return None;
    }
    let days = days_from_civil(year, month, day);
    if civil_from_days(days) != (year, month, day) {
        return None;
    }
    let ms = days
        .checked_mul(86_400_000)?
        .checked_add(hour * 3_600_000 + minute * 60_000 + second * 1_000 + milli)?;
    u64::try_from(ms).ok()
}

fn rfc3339_now() -> String {
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0);
    rfc3339_from_unix_ms(ms)
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = if month_prime < 10 {
        month_prime + 3
    } else {
        month_prime - 9
    };
    (if month <= 2 { year + 1 } else { year }, month, day)
}

#[cfg(test)]
fn days_from_civil(year: i64, month: i64, day: i64) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = year.div_euclid(400);
    let year_of_era = year.rem_euclid(400);
    let month_prime = if month > 2 { month - 3 } else { month + 9 };
    let day_of_year = (153 * month_prime + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::{
        bound_local_id_at, forget_at, mint_at, origin_digest, read_bindings_at,
        rfc3339_from_unix_ms, set_cloud_at, set_duplicated_from_at, set_origin_at,
        unix_ms_from_rfc3339,
    };
    use oleafly_core::content::ContentHash;
    use oleafly_core::ids::ProjectId;

    fn store(directory: &tempfile::TempDir) -> std::path::PathBuf {
        directory.path().join("project-ids.json")
    }

    #[test]
    fn minting_is_idempotent_per_local_project_and_never_clones_an_adopted_id() {
        let directory = tempfile::tempdir().unwrap();
        let path = store(&directory);
        let first = mint_at(&path, "paper", None, "2026-09-30T00:00:00.000Z".into()).unwrap();
        let again = mint_at(&path, "paper", None, "2027-01-01T00:00:00.000Z".into()).unwrap();
        assert_eq!(first, again);
        let adopted = ProjectId::new();
        let bound = mint_at(
            &path,
            "thesis",
            Some(adopted),
            "2026-09-30T00:00:00.000Z".into(),
        )
        .unwrap();
        assert_eq!(bound.project, adopted);
        assert!(mint_at(
            &path,
            "other",
            Some(adopted),
            "2026-09-30T00:00:00.000Z".into()
        )
        .is_err());
    }

    #[test]
    fn bindings_round_trip_with_duplicate_origin_and_cloud_fields() {
        let directory = tempfile::tempdir().unwrap();
        let path = store(&directory);
        let source = mint_at(&path, "source", None, "2026-09-30T00:00:00.000Z".into()).unwrap();
        mint_at(&path, "copy", None, "2026-09-30T00:00:00.000Z".into()).unwrap();
        set_duplicated_from_at(&path, "copy", source.project).unwrap();
        set_origin_at(&path, "copy", ContentHash::digest(b"files")).unwrap();
        let cloud = ProjectId::new();
        set_cloud_at(&path, "copy", "dbid:AAH4", Some(cloud)).unwrap();
        let bindings = read_bindings_at(&path).unwrap();
        let copy = &bindings["copy"];
        assert_eq!(copy.duplicated_from, Some(source.project));
        assert_eq!(
            copy.origin_digest.as_deref(),
            Some(ContentHash::digest(b"files").to_hex().as_str())
        );
        assert_eq!(copy.cloud["dbid:AAH4"], cloud);
        set_cloud_at(&path, "copy", "dbid:AAH4", None).unwrap();
        assert!(read_bindings_at(&path).unwrap()["copy"].cloud.is_empty());
        forget_at(&path, "copy").unwrap();
        assert!(!read_bindings_at(&path).unwrap().contains_key("copy"));
        assert!(forget_at(&path, "copy").is_ok());
    }

    #[test]
    fn bound_local_id_finds_direct_and_cloud_mapped_identities() {
        let directory = tempfile::tempdir().unwrap();
        let path = store(&directory);
        let adopted = ProjectId::new();
        mint_at(
            &path,
            "paper",
            Some(adopted),
            "2026-09-30T00:00:00.000Z".into(),
        )
        .unwrap();
        assert_eq!(
            bound_local_id_at(&path, adopted).unwrap().as_deref(),
            Some("paper")
        );
        let second = mint_at(&path, "thesis", None, "2026-09-30T00:00:00.000Z".into()).unwrap();
        let cloud = ProjectId::new();
        set_cloud_at(&path, "thesis", "dbid:test", Some(cloud)).unwrap();
        assert_eq!(
            bound_local_id_at(&path, cloud).unwrap().as_deref(),
            Some("thesis")
        );
        assert_eq!(
            bound_local_id_at(&path, second.project).unwrap().as_deref(),
            Some("thesis")
        );
        assert_eq!(bound_local_id_at(&path, ProjectId::new()).unwrap(), None);
    }

    #[test]
    fn a_corrupt_store_fails_closed_instead_of_being_replaced() {
        let directory = tempfile::tempdir().unwrap();
        let path = store(&directory);
        std::fs::write(&path, "not json").unwrap();
        assert!(mint_at(&path, "paper", None, "2026-09-30T00:00:00.000Z".into()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "not json");
    }

    #[test]
    fn origin_digest_sees_files_and_ignores_git_and_symlinks() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("main.tex"), "one").unwrap();
        std::fs::create_dir_all(root.join(".git")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref").unwrap();
        let first = origin_digest(root).unwrap();
        std::fs::write(root.join(".git/HEAD"), "other").unwrap();
        assert_eq!(origin_digest(root).unwrap(), first);
        std::fs::write(root.join("main.tex"), "two").unwrap();
        assert_ne!(origin_digest(root).unwrap(), first);
        let settled = origin_digest(root).unwrap();
        std::fs::write(root.join("main.aux"), "build").unwrap();
        std::fs::write(root.join("notes.txt~"), "junk").unwrap();
        assert_eq!(origin_digest(root).unwrap(), settled);
        #[cfg(unix)]
        {
            let current = origin_digest(root).unwrap();
            std::os::unix::fs::symlink("main.tex", root.join("link.tex")).unwrap();
            assert_eq!(origin_digest(root).unwrap(), current);
        }
    }

    #[test]
    fn origin_digest_ignores_quarto_output_but_not_calepin_results() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::write(root.join("report.qmd"), "# Report").unwrap();
        std::fs::create_dir_all(root.join("data_files")).unwrap();
        std::fs::write(root.join("data_files/raw.csv"), "a,b").unwrap();
        let settled = origin_digest(root).unwrap();
        for (folder, file) in [
            ("report_files/figure-html", "plot.png"),
            (".quarto/xref", "index.json"),
        ] {
            std::fs::create_dir_all(root.join(folder)).unwrap();
            std::fs::write(root.join(folder).join(file), "generated").unwrap();
        }
        assert_eq!(origin_digest(root).unwrap(), settled);
        std::fs::create_dir_all(root.join(".calepin")).unwrap();
        std::fs::write(root.join(".calepin/calepin.typ"), "results").unwrap();
        let with_results = origin_digest(root).unwrap();
        assert_ne!(with_results, settled);
        std::fs::remove_dir_all(root.join(".calepin")).unwrap();
        assert_eq!(origin_digest(root).unwrap(), settled);
        std::fs::write(root.join("data_files/raw.csv"), "a,b,c").unwrap();
        assert_ne!(origin_digest(root).unwrap(), settled);
    }

    #[test]
    fn rfc3339_conversion_round_trips_and_rejects_impossible_dates() {
        assert_eq!(rfc3339_from_unix_ms(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            rfc3339_from_unix_ms(1_790_000_000_123),
            "2026-09-21T14:13:20.123Z"
        );
        for ms in [
            0,
            1,
            86_399_999,
            951_782_400_000,
            1_790_000_000_123,
            4_102_444_800_000,
        ] {
            assert_eq!(
                unix_ms_from_rfc3339(&rfc3339_from_unix_ms(ms)),
                Some(ms),
                "{ms}"
            );
        }
        assert_eq!(unix_ms_from_rfc3339("2026-02-30T00:00:00.000Z"), None);
        assert_eq!(unix_ms_from_rfc3339("2026-13-01T00:00:00.000Z"), None);
        assert_eq!(unix_ms_from_rfc3339("2026-01-01 00:00:00.000Z"), None);
        assert_eq!(unix_ms_from_rfc3339("1969-12-31T23:59:59.999Z"), None);
    }
}
