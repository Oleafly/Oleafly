//! Pinned Biber support for biblatex projects.
//!
//! Tectonic 0.16 bundles biblatex 3.17, which requires Biber 2.17. System TeX
//! Live often ships a newer Biber that rejects Tectonic's control files. Oleafly
//! therefore prefers a co-packaged `tectonic-biber` (the name Tectonic looks up
//! first) and injects its directory onto PATH for the compile child.

use std::path::{Path, PathBuf};

/// Locate a version-pinned `tectonic-biber` binary for the current app layout.
pub fn find_tectonic_biber() -> Option<PathBuf> {
    tectonic_biber_candidates()
        .into_iter()
        .find(|path| path.is_file())
}

pub const UNPACK_ENV: &str = "PAR_GLOBAL_TMPDIR";

const FINGERPRINT_SAMPLE_BYTES: u64 = 1024 * 1024;

const LAST_USED_MARKER: &str = ".last-used";

const UNUSED_GRACE: std::time::Duration = std::time::Duration::from_secs(7 * 24 * 60 * 60);

const TOMBSTONE_MARK: &str = ".deleting-";

pub fn unpack_root(data_root: &Path) -> PathBuf {
    data_root.join("assets").join("biber")
}

pub(crate) fn unpack_dir_for(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    fingerprint(biber).map(|fingerprint| unpack_root(data_root).join(fingerprint))
}

pub fn prepare_unpack_dir(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    let dir = unpack_dir_for(data_root, biber)?;
    std::fs::create_dir_all(&dir).ok()?;
    if !dir.is_dir() {
        return None;
    }
    let _ = stamp_last_use(&dir, std::time::SystemTime::now());
    Some(dir)
}

fn stamp_last_use(dir: &Path, when: std::time::SystemTime) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LAST_USED_MARKER))?
        .set_modified(when)
}

pub fn biber_for_child(program: &Path, path_env: &std::ffi::OsStr) -> Option<PathBuf> {
    choose_child_biber(program, path_env, find_tectonic_biber)
}

/// What a supervised child needs so that the Biber it runs can start.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildBiber {
    /// The folder PAR::Packer unpacks into (`PAR_GLOBAL_TMPDIR`).
    pub unpack_dir: PathBuf,
    /// A folder holding a thin copy of a universal macOS Biber, which has to
    /// come first on the child's PATH.
    pub thin_dir: Option<PathBuf>,
}

impl ChildBiber {
    /// The child's PATH with the thin Biber folder, if any, in front.
    pub fn path_env(&self, path_env: &std::ffi::OsStr) -> std::ffi::OsString {
        let Some(thin_dir) = &self.thin_dir else {
            return path_env.to_os_string();
        };
        let rest = std::env::split_paths(path_env).filter(|dir| dir != thin_dir);
        std::env::join_paths(std::iter::once(thin_dir.clone()).chain(rest))
            .unwrap_or_else(|_| path_env.to_os_string())
    }
}

/// Prepare the Biber a child will run. This reads and may copy a large file,
/// so async callers should run it on a blocking thread.
pub fn prepare_child_biber(
    data_root: &Path,
    program: &Path,
    path_env: &std::ffi::OsStr,
) -> Option<ChildBiber> {
    let biber = biber_for_child(program, path_env)?;
    prepare_biber_for(data_root, program, &biber)
}

fn prepare_biber_for(data_root: &Path, program: &Path, biber: &Path) -> Option<ChildBiber> {
    let unpack_dir = prepare_unpack_dir(data_root, biber)?;
    // Only latexmk runs the system Biber it finds on PATH. Every other child
    // runs the thin, packaged tectonic-biber, and putting a TeX Live Biber in
    // front of it would swap a start failure for a version mismatch.
    let thin_dir = if is_latexmk(program) {
        runnable_biber_dir(data_root, biber)
    } else {
        None
    };
    Some(ChildBiber {
        unpack_dir,
        thin_dir,
    })
}

fn program_stem(program: &Path) -> String {
    program
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_latexmk(program: &Path) -> bool {
    program_stem(program) == "latexmk"
}

fn choose_child_biber(
    program: &Path,
    path_env: &std::ffi::OsStr,
    bundled: impl FnOnce() -> Option<PathBuf>,
) -> Option<PathBuf> {
    let name = program_stem(program);
    if name == "biber" || name.starts_with("tectonic-biber") {
        return Some(program.to_path_buf());
    }
    if name == "latexmk" {
        return first_biber_on(path_env);
    }
    bundled().or_else(|| first_biber_on(path_env))
}

/// Subfolder of a Biber's unpack folder that holds the thin copy of a
/// universal macOS Biber.
const THIN_BIBER_DIR: &str = "bin";

const THIN_BIBER_NAME: &str = "biber";

const FAT_MAGIC: u32 = 0xcafe_babe;

const FAT_MAGIC_64: u32 = 0xcafe_babf;

const FAT_ARCH_LEN: usize = 20;

const FAT_ARCH_64_LEN: usize = 32;

/// Real universal binaries hold a handful of slices. The cap also rules out
/// Java class files, which share `0xcafebabe` and keep their class-file
/// version (45 or more) where a universal binary keeps its slice count.
const MAX_FAT_SLICES: u32 = 16;

const FAT_HEADER_MAX: u64 = 8 + MAX_FAT_SLICES as u64 * FAT_ARCH_64_LEN as u64;

const CPU_TYPE_X86_64: u32 = 0x0100_0007;

const CPU_TYPE_ARM64: u32 = 0x0100_000c;

const CPU_SUBTYPE_MASK: u32 = 0xff00_0000;

const CPU_SUBTYPE_ARM64E: u32 = 2;

const CPU_SUBTYPE_X86_64_H: u32 = 8;

/// Where one architecture's slice sits inside a universal (fat) Mach-O file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FatSlice {
    offset: u64,
    size: u64,
}

fn host_cpu_type() -> Option<u32> {
    match std::env::consts::ARCH {
        "aarch64" => Some(CPU_TYPE_ARM64),
        "x86_64" => Some(CPU_TYPE_X86_64),
        _ => None,
    }
}

/// A universal (fat) Biber does not start on current macOS. Biber is packed
/// with PAR::Packer, and the loader of a universal build runs
/// `/usr/bin/lipo <self> -extract_family <arch>` at every start. The lipo in
/// recent Xcode rejects that flag, and a Mac without developer tools has no
/// lipo to run at all. TeX Live's Biber and the one in Oleafly's managed
/// TinyTeX are both universal.
///
/// This copies the host's slice out of the universal file byte for byte (the
/// same bytes `lipo -thin` writes) into the Biber's own unpack folder, so
/// pruning keeps it while that Biber is in use and removes it after an update.
/// It returns the folder holding the copy, or None for a thin Biber and on
/// other systems.
fn runnable_biber_dir(data_root: &Path, biber: &Path) -> Option<PathBuf> {
    if !cfg!(target_os = "macos") {
        return None;
    }
    let cpu_type = host_cpu_type()?;
    match extract_host_slice(data_root, biber, cpu_type) {
        Ok(dir) => dir,
        Err(error) => {
            let message = format!(
                "Could not copy the {} part out of the universal Biber at {}: {error}",
                std::env::consts::ARCH,
                biber.display()
            );
            eprintln!("biber: {message}");
            let _ = crate::project::append_app_log(message);
            None
        }
    }
}

fn extract_host_slice(
    data_root: &Path,
    biber: &Path,
    cpu_type: u32,
) -> std::io::Result<Option<PathBuf>> {
    use std::io::{Read, Seek};
    let mut source = std::fs::File::open(biber)?;
    let file_len = source.metadata()?.len();
    let mut header = Vec::new();
    source
        .by_ref()
        .take(FAT_HEADER_MAX)
        .read_to_end(&mut header)?;
    let Some(slice) = fat_slice_for(&header, file_len, cpu_type) else {
        return Ok(None);
    };
    let Some(unpack_dir) = unpack_dir_for(data_root, biber) else {
        return Ok(None);
    };
    let dir = unpack_dir.join(THIN_BIBER_DIR);
    let thin = dir.join(THIN_BIBER_NAME);
    if std::fs::metadata(&thin).is_ok_and(|meta| meta.is_file() && meta.len() == slice.size) {
        return Ok(Some(dir));
    }
    std::fs::create_dir_all(&dir)?;
    // Two compiles can race here, so each writes its own temporary file and
    // renames it into place; the rename replaces the file atomically.
    let mut staged = tempfile::Builder::new()
        .prefix(".biber-")
        .tempfile_in(&dir)?;
    source.seek(std::io::SeekFrom::Start(slice.offset))?;
    let copied = std::io::copy(&mut source.take(slice.size), staged.as_file_mut())?;
    if copied != slice.size {
        return Err(std::io::ErrorKind::UnexpectedEof.into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        // Owner only: the copy lives in this user's app folder and only this
        // user runs it.
        staged
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o700))?;
    }
    staged.persist(&thin).map_err(|error| error.error)?;
    Ok(Some(dir))
}

/// Find the slice built for `cpu_type` in the header of a universal Mach-O
/// file. Returns None for thin binaries, for anything that is not a
/// well-formed universal header, and when no slice matches.
fn fat_slice_for(header: &[u8], file_len: u64, cpu_type: u32) -> Option<FatSlice> {
    let entry_len = match be_u32(header, 0)? {
        FAT_MAGIC => FAT_ARCH_LEN,
        FAT_MAGIC_64 => FAT_ARCH_64_LEN,
        _ => return None,
    };
    let count = be_u32(header, 4)?;
    if count == 0 || count > MAX_FAT_SLICES {
        return None;
    }
    let table_end = 8 + count as usize * entry_len;
    if header.len() < table_end {
        return None;
    }
    let mut specialised = None;
    for entry in (8..table_end).step_by(entry_len) {
        if be_u32(header, entry)? != cpu_type {
            continue;
        }
        let (offset, size) = if entry_len == FAT_ARCH_64_LEN {
            (be_u64(header, entry + 8)?, be_u64(header, entry + 16)?)
        } else {
            (
                u64::from(be_u32(header, entry + 8)?),
                u64::from(be_u32(header, entry + 12)?),
            )
        };
        if size == 0 || offset < table_end as u64 || offset.checked_add(size)? > file_len {
            return None;
        }
        let slice = FatSlice { offset, size };
        let subtype = be_u32(header, entry + 4)? & !CPU_SUBTYPE_MASK;
        if is_specialised_subtype(cpu_type, subtype) {
            specialised.get_or_insert(slice);
        } else {
            return Some(slice);
        }
    }
    specialised
}

/// arm64e and x86_64h slices only run on some Macs (arm64e not at all outside
/// Apple's own binaries), so the plain slice wins when both are present.
fn is_specialised_subtype(cpu_type: u32, subtype: u32) -> bool {
    matches!(
        (cpu_type, subtype),
        (CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64E) | (CPU_TYPE_X86_64, CPU_SUBTYPE_X86_64_H)
    )
}

fn be_u32(bytes: &[u8], at: usize) -> Option<u32> {
    let word = bytes.get(at..at.checked_add(4)?)?;
    Some(u32::from_be_bytes(word.try_into().ok()?))
}

fn be_u64(bytes: &[u8], at: usize) -> Option<u64> {
    let word = bytes.get(at..at.checked_add(8)?)?;
    Some(u64::from_be_bytes(word.try_into().ok()?))
}

fn first_biber_on(path_env: &std::ffi::OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_env)
        .filter(|dir| dir.is_absolute())
        .find_map(|dir| crate::tex_distro::find_tool_in_dir(&dir, "biber"))
}

fn bibers_in_use() -> Vec<PathBuf> {
    bibers_for_programs(&compile_programs())
}

fn compile_programs() -> Vec<PathBuf> {
    [
        find_tectonic_biber(),
        crate::document_engine::resolve_bundled_sidecar("tectonic").ok(),
        crate::tex_distro::find_tex_tool("latexmk"),
    ]
    .into_iter()
    .flatten()
    .collect()
}

pub(crate) fn bibers_for_programs(programs: &[PathBuf]) -> Vec<PathBuf> {
    let mut bibers = Vec::new();
    for program in programs {
        if let Some(biber) = biber_for_child(program, &tool_path_env(program)) {
            push_unique(&mut bibers, biber);
        }
    }
    bibers
}

type FingerprintCache =
    std::collections::HashMap<PathBuf, (u64, Option<std::time::SystemTime>, String)>;

fn fingerprint(path: &Path) -> Option<String> {
    static CACHE: std::sync::OnceLock<std::sync::Mutex<FingerprintCache>> =
        std::sync::OnceLock::new();
    let metadata = std::fs::metadata(path).ok()?;
    let stamp = (metadata.len(), metadata.modified().ok());
    let cache = CACHE.get_or_init(Default::default);
    let lock = || {
        cache
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    };
    if let Some((len, modified, fingerprint)) = lock().get(path) {
        if (*len, *modified) == stamp {
            return Some(fingerprint.clone());
        }
    }
    let fingerprint = binary_fingerprint(path).ok()?;
    lock().insert(path.to_path_buf(), (stamp.0, stamp.1, fingerprint.clone()));
    Some(fingerprint)
}

fn binary_fingerprint(path: &Path) -> std::io::Result<String> {
    use sha2::Digest;
    let mut file = std::fs::File::open(path)?;
    let len = file.metadata()?.len();
    let mut hasher = sha2::Sha256::new();
    hasher.update(len.to_le_bytes());
    let head = len.min(FINGERPRINT_SAMPLE_BYTES);
    hash_file_range(&mut file, 0, head, &mut hasher)?;
    let tail_start = len.saturating_sub(FINGERPRINT_SAMPLE_BYTES).max(head);
    hash_file_range(&mut file, tail_start, len - tail_start, &mut hasher)?;
    Ok(hasher.finalize()[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}

fn hash_file_range(
    file: &mut std::fs::File,
    start: u64,
    len: u64,
    hasher: &mut sha2::Sha256,
) -> std::io::Result<()> {
    use std::io::{Read, Seek};
    file.seek(std::io::SeekFrom::Start(start))?;
    let copied = std::io::copy(&mut file.by_ref().take(len), hasher)?;
    if copied != len {
        return Err(std::io::ErrorKind::UnexpectedEof.into());
    }
    Ok(())
}

pub fn prune_stale_unpacks() {
    let Ok(data_root) = crate::paths::oleafly_root() else {
        return;
    };
    let keep: Vec<String> = bibers_in_use()
        .iter()
        .filter_map(|biber| fingerprint(biber))
        .collect();
    let outcome = prune_unpack_root(
        &unpack_root(&data_root),
        &keep,
        std::time::SystemTime::now(),
    );
    if outcome.removed > 0 {
        let _ = crate::project::append_app_log(format!(
            "Removed old Biber unpacks: {}",
            outcome.removed
        ));
    }
    for failure in outcome.failures {
        eprintln!("biber: could not remove an old unpack: {failure}");
        let _ = crate::project::append_app_log(format!(
            "Could not remove an old Biber unpack: {failure}"
        ));
    }
}

#[derive(Debug, Default)]
struct PruneOutcome {
    removed: usize,
    failures: Vec<String>,
}

impl PruneOutcome {
    fn fail(&mut self, path: &Path, error: std::io::Error) {
        self.failures.push(format!("{}: {error}", path.display()));
    }

    fn record(&mut self, path: &Path, result: std::io::Result<()>) {
        match result {
            Ok(()) => self.removed += 1,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => self.fail(path, error),
        }
    }
}

fn prune_unpack_root(root: &Path, keep: &[String], now: std::time::SystemTime) -> PruneOutcome {
    prune_unpack_root_with(root, keep, now, |from, to| std::fs::rename(from, to))
}

fn prune_unpack_root_with(
    root: &Path,
    keep: &[String],
    now: std::time::SystemTime,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> PruneOutcome {
    let mut outcome = PruneOutcome::default();
    let entries = match unpack_entries(root) {
        Ok(entries) => entries,
        Err(error) => {
            outcome.fail(root, error);
            return outcome;
        }
    };
    for path in entries {
        let Some(name) = path.file_name() else {
            continue;
        };
        if is_tombstone(name) {
            outcome.record(&path, remove_in_place(&path));
        } else if !keep.iter().any(|keep| name == std::ffi::OsStr::new(keep))
            && !used_within_grace(&path, now)
        {
            outcome.record(&path, retire_unpack_entry(&path, &rename));
        }
    }
    outcome
}

fn unpack_entries(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    match std::fs::symlink_metadata(root) {
        Ok(metadata) if metadata.file_type().is_dir() => {}
        Ok(_) => return Ok(Vec::new()),
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(Vec::new())
        }
        Err(error) => return Err(error),
    }
    std::fs::read_dir(root)?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect()
}

fn retire_unpack_entry(
    path: &Path,
    rename: &impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> std::io::Result<()> {
    if !std::fs::symlink_metadata(path)?.file_type().is_dir() {
        return remove_in_place(path);
    }
    let tombstone = unused_tombstone_for(path)?;
    rename(path, &tombstone)?;
    match remove_in_place(&tombstone) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
}

fn unused_tombstone_for(path: &Path) -> std::io::Result<PathBuf> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return Err(std::io::ErrorKind::InvalidInput.into());
    };
    for _ in 0..64 {
        let mut tombstone = std::ffi::OsString::from(".");
        tombstone.push(name);
        tombstone.push(format!(
            "{TOMBSTONE_MARK}{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let candidate = parent.join(tombstone);
        match std::fs::symlink_metadata(&candidate) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(candidate),
            Err(error) => return Err(error),
            Ok(_) => {}
        }
    }
    Err(std::io::ErrorKind::AlreadyExists.into())
}

fn is_tombstone(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    let Some((_, suffix)) = name
        .strip_prefix('.')
        .and_then(|rest| rest.rsplit_once(TOMBSTONE_MARK))
    else {
        return false;
    };
    suffix.split_once('-').is_some_and(|(pid, serial)| {
        [pid, serial]
            .iter()
            .all(|part| !part.is_empty() && part.bytes().all(|byte| byte.is_ascii_digit()))
    })
}

fn used_within_grace(path: &Path, now: std::time::SystemTime) -> bool {
    let Some(used) = last_used(path) else {
        return false;
    };
    match now.duration_since(used) {
        Ok(age) => age < UNUSED_GRACE,
        Err(ahead) => ahead.duration() < UNUSED_GRACE,
    }
}

fn last_used(path: &Path) -> Option<std::time::SystemTime> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    let marker = if metadata.is_dir() {
        std::fs::symlink_metadata(path.join(LAST_USED_MARKER)).ok()
    } else {
        None
    };
    marker.unwrap_or(metadata).modified().ok()
}

fn remove_in_place(path: &Path) -> std::io::Result<()> {
    let file_type = std::fs::symlink_metadata(path)?.file_type();
    if file_type.is_symlink() {
        remove_link(path, file_type)
    } else if file_type.is_dir() {
        std::fs::remove_dir_all(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[cfg(windows)]
fn remove_link(path: &Path, file_type: std::fs::FileType) -> std::io::Result<()> {
    use std::os::windows::fs::FileTypeExt;
    if file_type.is_symlink_dir() {
        std::fs::remove_dir(path)
    } else {
        std::fs::remove_file(path)
    }
}

#[cfg(not(windows))]
fn remove_link(path: &Path, _file_type: std::fs::FileType) -> std::io::Result<()> {
    std::fs::remove_file(path)
}

/// Directories that should precede PATH when spawning Tectonic so it can find
/// `tectonic-biber` and common system TeX helpers.
pub fn compile_path_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let base = if parent.ends_with("deps") {
                parent.parent().unwrap_or(parent)
            } else {
                parent
            };
            push_unique(&mut dirs, base.to_path_buf());
        }
    }

    if let Some(biber) = find_tectonic_biber() {
        if let Some(parent) = biber.parent() {
            push_unique(&mut dirs, parent.to_path_buf());
        }
    }

    for dir in tex_bin_search_dirs() {
        if dir.is_dir() {
            push_unique(&mut dirs, dir);
        }
    }

    dirs
}

/// Build a PATH value with toolchain directories first.
#[cfg(test)]
pub fn compile_path_env() -> std::ffi::OsString {
    compile_path_env_with_inherited(std::env::var_os("PATH").as_deref(), None, None)
}

pub fn tool_path_env(preferred_executable: &Path) -> std::ffi::OsString {
    compile_path_env_with_inherited(
        std::env::var_os("PATH").as_deref(),
        preferred_executable.parent(),
        None,
    )
}

pub fn compile_path_env_for(
    preferred_executable: &Path,
    excluded_project_root: &Path,
) -> std::ffi::OsString {
    compile_path_env_with_inherited(
        std::env::var_os("PATH").as_deref(),
        preferred_executable.parent(),
        Some(excluded_project_root),
    )
}

fn compile_path_env_with_inherited(
    inherited: Option<&std::ffi::OsStr>,
    preferred_dir: Option<&Path>,
    excluded_root: Option<&Path>,
) -> std::ffi::OsString {
    let mut dirs = Vec::new();
    let mut add = |dir: PathBuf| {
        if dir.is_absolute() && !excluded_root.is_some_and(|root| path_is_within(&dir, root)) {
            push_unique(&mut dirs, dir);
        }
    };
    if let Some(preferred) = preferred_dir {
        add(preferred.to_path_buf());
    }
    for dir in compile_path_dirs() {
        add(dir);
    }
    if let Some(inherited) = inherited {
        for dir in std::env::split_paths(inherited) {
            if dir.is_absolute() {
                add(dir);
            }
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

fn path_is_within(path: &Path, root: &Path) -> bool {
    let resolved_path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
    let resolved_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    resolved_path == resolved_root || resolved_path.starts_with(&resolved_root)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BblStamp {
    modified: Option<std::time::SystemTime>,
    len: u64,
}

pub fn bbl_stamp(out_dir: &Path, entry_stem: &str) -> Option<BblStamp> {
    let bbl = out_dir.join(format!("{entry_stem}.bbl"));
    let meta = std::fs::metadata(&bbl).ok()?;
    Some(BblStamp {
        modified: meta.modified().ok(),
        len: meta.len(),
    })
}

pub fn bbl_refreshed(out_dir: &Path, entry_stem: &str, before: Option<BblStamp>) -> bool {
    match bbl_stamp(out_dir, entry_stem) {
        Some(after) => {
            after.len > 0 && (Some(after) != before || biber_wrote_bbl(out_dir, entry_stem))
        }
        None => false,
    }
}

fn biber_wrote_bbl(out_dir: &Path, entry_stem: &str) -> bool {
    let Ok(log) = std::fs::read_to_string(out_dir.join(format!("{entry_stem}.blg"))) else {
        return false;
    };
    let marker = format!("INFO - Output to {entry_stem}.bbl");
    log.lines()
        .map(strip_biber_log_prefix)
        .any(|line| line.trim_end_matches('\r') == marker)
}

pub fn biber_message_excerpt(log: &str) -> String {
    let mut excerpt = String::new();
    for line in log
        .lines()
        .map(strip_biber_log_prefix)
        .filter(|line| line.starts_with("WARN - ") || line.starts_with("ERROR - "))
        .take(40)
    {
        excerpt.push_str(line.trim_end_matches('\r'));
        excerpt.push('\n');
    }
    excerpt
}

fn strip_biber_log_prefix(line: &str) -> &str {
    let rest = line.strip_prefix('[').unwrap_or(line);
    if rest.len() == line.len() {
        return line;
    }
    let Some(close) = rest.find("] ") else {
        return line;
    };
    if !rest[..close].bytes().all(|byte| byte.is_ascii_digit()) {
        return line;
    }
    let after = &rest[close + 2..];
    match after.find("> ") {
        Some(marker) if !after[..marker].contains(' ') => &after[marker + 2..],
        _ => line,
    }
}

/// Classify a failed or incomplete Biber step for the user-facing log.
pub fn diagnose_biber_gap(log: &str, biber: Option<&Path>) -> String {
    let mut message = String::from(
        "\n[Oleafly] Bibliography needs Biber (biblatex), but a usable .bbl was not produced.\n",
    );
    if let Some(file) = missing_data_source(log) {
        message.push_str(&format!(
            "[Oleafly] Biber could not find the bibliography file {file} (mode C). Check the name \
in \\addbibresource or \\bibliography; Oleafly resolves it from the project root.\n"
        ));
    } else if log.contains("versions are incompatible") || log.contains("control file version") {
        message.push_str(
            "[Oleafly] Biber/biblatex version mismatch (mode B): the Biber on PATH does not match \
Tectonic's bundled biblatex. Prefer the packaged tectonic-biber (Biber 2.17 for Tectonic 0.16).\n",
        );
    } else if biber.is_none()
        || log.contains("No such file or directory (os error 2)")
        || (log.contains("Running external tool biber") && log.contains("No such file"))
    {
        message.push_str(
            "[Oleafly] Biber was not found (mode A): GUI launches often have a minimal PATH, and \
Oleafly could not locate the packaged tectonic-biber sidecar. Reinstall Oleafly or run \
scripts/fetch-biber.sh for your platform, then compile again.\n",
        );
    } else {
        message.push_str(
            "[Oleafly] Biber was available but the bibliography step still failed. Check the Biber \
messages above, then recompile.\n",
        );
        if let Some(path) = biber {
            message.push_str(&format!("[Oleafly] Using Biber at: {}\n", path.display()));
        }
    }
    message
}

fn missing_data_source(log: &str) -> Option<&str> {
    let start = log.find("ERROR - Cannot find '")? + "ERROR - Cannot find '".len();
    let rest = &log[start..];
    let end = rest.find('\'')?;
    Some(&rest[..end])
}

/// CLI args for running Biber on the entry stem written under `out_dir`.
/// Callers should spawn via the supervised compile process path so timeout,
/// cancel, and process-group isolation match Tectonic.
pub fn biber_cli_args(out_dir: &Path, entry_stem: &str) -> Vec<String> {
    vec![
        "--output-directory".into(),
        out_dir.to_string_lossy().into_owned(),
        "--input-directory".into(),
        out_dir.to_string_lossy().into_owned(),
        entry_stem.into(),
    ]
}

fn tectonic_biber_candidates() -> Vec<PathBuf> {
    let name = if cfg!(windows) {
        "tectonic-biber.exe"
    } else {
        "tectonic-biber"
    };
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let base = if parent.ends_with("deps") {
                parent.parent().unwrap_or(parent)
            } else {
                parent
            };
            candidates.push(base.join(name));
        }
    }
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    candidates.push(manifest.join("target/debug").join(name));
    candidates.push(manifest.join("target/release").join(name));
    if let Some(triple) = host_triple_guess() {
        let triple_name = if cfg!(windows) {
            format!("tectonic-biber-{triple}.exe")
        } else {
            format!("tectonic-biber-{triple}")
        };
        candidates.push(manifest.join("binaries").join(&triple_name));
    }
    candidates
}

pub(crate) fn host_triple_guess() -> Option<&'static str> {
    match (std::env::consts::ARCH, std::env::consts::OS) {
        ("aarch64", "macos") => Some("aarch64-apple-darwin"),
        ("x86_64", "macos") => Some("x86_64-apple-darwin"),
        ("x86_64", "linux") => Some("x86_64-unknown-linux-gnu"),
        ("aarch64", "linux") => Some("aarch64-unknown-linux-gnu"),
        ("x86_64", "windows") => Some("x86_64-pc-windows-msvc"),
        _ => None,
    }
}

fn tex_bin_search_dirs() -> Vec<PathBuf> {
    // Shared discovery (MacTeX, TeX Live by year, MiKTeX, TinyTeX variants) so
    // PATH injection and the latexmk engine agree on where TeX tools live.
    crate::tex_distro::tex_bin_dirs()
}

fn push_unique(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biber_unpacks_under_the_data_root_assets() {
        let root = Path::new("data-root");
        assert_eq!(
            unpack_root(root),
            Path::new("data-root").join("assets").join("biber")
        );
    }

    fn fake_biber(dir: &Path, name: &str, seed: u8) -> PathBuf {
        std::fs::create_dir_all(dir).unwrap();
        let path = dir.join(name);
        let bytes: Vec<u8> = (0..4096u32)
            .map(|index| (index as u8).wrapping_mul(31).wrapping_add(seed))
            .collect();
        std::fs::write(&path, bytes).unwrap();
        path
    }

    fn age_marker(dir: &Path, when: std::time::SystemTime) {
        stamp_last_use(dir, when).unwrap();
    }

    fn after_the_grace_period() -> std::time::SystemTime {
        std::time::SystemTime::now() + UNUSED_GRACE * 2
    }

    fn keeping(names: &[&str]) -> Vec<String> {
        names.iter().map(|name| name.to_string()).collect()
    }

    #[test]
    fn each_biber_unpacks_into_a_folder_named_after_its_own_fingerprint() {
        let directory = tempfile::tempdir().unwrap();
        let data = Path::new("data-root");
        let bundled = fake_biber(&directory.path().join("app"), "tectonic-biber", 1);
        let copy = fake_biber(&directory.path().join("copy"), "tectonic-biber", 1);
        let system = fake_biber(&directory.path().join("texbin"), "biber", 2);

        let bundled_dir = unpack_dir_for(data, &bundled).unwrap();
        let system_dir = unpack_dir_for(data, &system).unwrap();

        assert_eq!(bundled_dir.parent(), Some(unpack_root(data).as_path()));
        assert_eq!(system_dir.parent(), Some(unpack_root(data).as_path()));
        assert_ne!(bundled_dir, system_dir);
        assert_eq!(unpack_dir_for(data, &copy), Some(bundled_dir));
        assert_eq!(
            unpack_dir_for(data, &directory.path().join("missing")),
            None
        );
    }

    #[test]
    fn the_fingerprint_is_stable_short_and_follows_the_content() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("biber");
        let sample = FINGERPRINT_SAMPLE_BYTES as usize;
        let mut bytes: Vec<u8> = (0..3 * sample).map(|index| (index % 251) as u8).collect();
        std::fs::write(&path, &bytes).unwrap();
        let original = binary_fingerprint(&path).unwrap();
        assert_eq!(original.len(), 8);
        assert!(original.bytes().all(|byte| byte.is_ascii_hexdigit()));
        assert_eq!(binary_fingerprint(&path).unwrap(), original);

        let copy = directory.path().join("biber-copy");
        std::fs::write(&copy, &bytes).unwrap();
        assert_eq!(binary_fingerprint(&copy).unwrap(), original);

        let last = bytes.len() - 1;
        bytes[last] ^= 0xff;
        std::fs::write(&path, &bytes).unwrap();
        assert_ne!(binary_fingerprint(&path).unwrap(), original);
        bytes[last] ^= 0xff;

        bytes[0] ^= 0xff;
        std::fs::write(&path, &bytes).unwrap();
        assert_ne!(binary_fingerprint(&path).unwrap(), original);
        bytes[0] ^= 0xff;

        bytes.push(0);
        std::fs::write(&path, &bytes).unwrap();
        assert_ne!(binary_fingerprint(&path).unwrap(), original);
    }

    #[test]
    fn small_and_empty_binaries_are_fingerprinted_whole() {
        let directory = tempfile::tempdir().unwrap();
        let empty = directory.path().join("empty");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(binary_fingerprint(&empty).unwrap().len(), 8);

        let path = directory.path().join("small");
        let mut bytes = vec![7u8; FINGERPRINT_SAMPLE_BYTES as usize + 4096];
        std::fs::write(&path, &bytes).unwrap();
        let original = binary_fingerprint(&path).unwrap();
        bytes[FINGERPRINT_SAMPLE_BYTES as usize + 10] = 8;
        std::fs::write(&path, &bytes).unwrap();
        assert_ne!(binary_fingerprint(&path).unwrap(), original);
        assert!(binary_fingerprint(&directory.path().join("missing")).is_err());
    }

    #[test]
    fn a_replaced_biber_is_fingerprinted_again() {
        let directory = tempfile::tempdir().unwrap();
        let path = fake_biber(directory.path(), "biber", 3);
        let before = fingerprint(&path).unwrap();
        assert_eq!(fingerprint(&path), Some(before.clone()));

        let mut upgraded = std::fs::read(&path).unwrap();
        upgraded.extend_from_slice(b"upgraded");
        std::fs::write(&path, upgraded).unwrap();

        let after = fingerprint(&path).unwrap();
        assert_ne!(after, before);
        assert_eq!(after, binary_fingerprint(&path).unwrap());
    }

    #[test]
    fn preparing_an_unpack_dir_creates_it_once_and_stamps_each_use() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let biber = fake_biber(&directory.path().join("bin"), "biber", 4);

        let first = prepare_unpack_dir(&data, &biber).expect("created");
        assert_eq!(Some(first.clone()), unpack_dir_for(&data, &biber));
        assert!(first.is_dir());
        std::fs::write(first.join("kept"), b"x").unwrap();
        let long_ago = std::time::SystemTime::now() - UNUSED_GRACE * 4;
        age_marker(&first, long_ago);
        assert!(!used_within_grace(&first, std::time::SystemTime::now()));

        let second = prepare_unpack_dir(&data, &biber).expect("reused");

        assert_eq!(first, second);
        assert!(second.join("kept").is_file());
        assert!(used_within_grace(&second, std::time::SystemTime::now()));
    }

    #[test]
    fn a_biber_that_cannot_be_read_gets_no_unpack_dir() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");

        assert_eq!(
            prepare_unpack_dir(&data, &directory.path().join("missing")),
            None
        );
        assert!(!data.exists());
    }

    #[test]
    fn an_unusable_unpack_root_is_skipped_so_biber_keeps_its_default() {
        let root = scratch_dir("unpack-blocked");
        let biber = fake_biber(&root.join("bin"), "biber", 5);
        std::fs::write(root.join("assets"), b"not a directory").unwrap();
        assert!(prepare_unpack_dir(&root, &biber).is_none());
        let outcome = prune_unpack_root(&unpack_root(&root), &[], after_the_grace_period());
        assert_eq!(outcome.removed, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert!(root.join("assets").is_file());
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn a_direct_biber_run_unpacks_for_that_binary() {
        let empty = std::ffi::OsString::new();
        let bundled = || Some(PathBuf::from("/app/tectonic-biber"));
        for name in [
            "biber",
            "biber.exe",
            "tectonic-biber",
            "tectonic-biber-x86_64-pc-windows-msvc.exe",
        ] {
            let program = Path::new("/opt/tools").join(name);
            assert_eq!(
                choose_child_biber(&program, &empty, bundled),
                Some(program.clone())
            );
        }
    }

    #[test]
    fn latexmk_unpacks_for_the_first_biber_on_its_path() {
        let directory = tempfile::tempdir().unwrap();
        let without = directory.path().join("without");
        std::fs::create_dir_all(&without).unwrap();
        let first = fake_biber(
            &directory.path().join("first"),
            &crate::tex_distro::exe("biber"),
            6,
        );
        fake_biber(
            &directory.path().join("second"),
            &crate::tex_distro::exe("biber"),
            7,
        );
        let path_env = std::env::join_paths([
            without.clone(),
            first.parent().unwrap().to_path_buf(),
            directory.path().join("second"),
        ])
        .unwrap();
        let latexmk = directory
            .path()
            .join("texbin")
            .join(crate::tex_distro::exe("latexmk"));
        let bundled = || Some(directory.path().join("app").join("tectonic-biber"));

        assert_eq!(
            choose_child_biber(&latexmk, &path_env, bundled),
            Some(first)
        );
        assert_eq!(
            choose_child_biber(&latexmk, &std::env::join_paths([without]).unwrap(), bundled),
            None
        );
    }

    #[test]
    fn other_children_unpack_for_the_bundled_biber_first() {
        let directory = tempfile::tempdir().unwrap();
        let system = fake_biber(
            &directory.path().join("texbin"),
            &crate::tex_distro::exe("biber"),
            8,
        );
        let path_env = std::env::join_paths([system.parent().unwrap()]).unwrap();
        let bundled = directory.path().join("app").join("tectonic-biber");

        for program in ["tectonic", "pandoc", "lualatex", ""] {
            let program = Path::new(program);
            assert_eq!(
                choose_child_biber(program, &path_env, || Some(bundled.clone())),
                Some(bundled.clone())
            );
            assert_eq!(
                choose_child_biber(program, &path_env, || None),
                Some(system.clone())
            );
        }
    }

    const INTEL: &[u8] = b"#!/bin/sh\necho x86_64\n";
    const APPLE: &[u8] = b"#!/bin/sh\necho arm64\n";

    struct Slice<'a> {
        cpu_type: u32,
        subtype: u32,
        offset: u64,
        bytes: &'a [u8],
    }

    fn slice(cpu_type: u32, subtype: u32, offset: u64, bytes: &[u8]) -> Slice<'_> {
        Slice {
            cpu_type,
            subtype,
            offset,
            bytes,
        }
    }

    fn fat_header(magic: u32, count: u32, slices: &[Slice<'_>]) -> Vec<u8> {
        let mut header = Vec::new();
        header.extend_from_slice(&magic.to_be_bytes());
        header.extend_from_slice(&count.to_be_bytes());
        for slice in slices {
            header.extend_from_slice(&slice.cpu_type.to_be_bytes());
            header.extend_from_slice(&slice.subtype.to_be_bytes());
            let size = slice.bytes.len() as u64;
            if magic == FAT_MAGIC_64 {
                header.extend_from_slice(&slice.offset.to_be_bytes());
                header.extend_from_slice(&size.to_be_bytes());
                header.extend_from_slice(&12u32.to_be_bytes());
                header.extend_from_slice(&0u32.to_be_bytes());
            } else {
                header.extend_from_slice(&(slice.offset as u32).to_be_bytes());
                header.extend_from_slice(&(size as u32).to_be_bytes());
                header.extend_from_slice(&12u32.to_be_bytes());
            }
        }
        header
    }

    fn universal(magic: u32, slices: &[Slice<'_>]) -> Vec<u8> {
        let mut file = fat_header(magic, slices.len() as u32, slices);
        for slice in slices {
            file.resize(slice.offset as usize, 0);
            file.extend_from_slice(slice.bytes);
        }
        file
    }

    fn intel_and_apple() -> [Slice<'static>; 2] {
        [
            slice(CPU_TYPE_X86_64, 3, 4096, INTEL),
            slice(CPU_TYPE_ARM64, 0, 8192, APPLE),
        ]
    }

    fn slice_in(file: &[u8], cpu_type: u32) -> Option<FatSlice> {
        fat_slice_for(file, file.len() as u64, cpu_type)
    }

    #[test]
    fn a_universal_header_names_the_slice_for_each_cpu() {
        for magic in [FAT_MAGIC, FAT_MAGIC_64] {
            let file = universal(magic, &intel_and_apple());
            assert_eq!(
                slice_in(&file, CPU_TYPE_X86_64),
                Some(FatSlice {
                    offset: 4096,
                    size: INTEL.len() as u64
                }),
                "{magic:#x}"
            );
            let apple = slice_in(&file, CPU_TYPE_ARM64).unwrap();
            assert_eq!(
                &file[apple.offset as usize..(apple.offset + apple.size) as usize],
                APPLE
            );
        }
    }

    #[test]
    fn the_64_bit_header_reads_offsets_past_four_gigabytes() {
        let far = (1u64 << 32) + 4096;
        let header = fat_header(
            FAT_MAGIC_64,
            2,
            &[
                slice(CPU_TYPE_X86_64, 3, 4096, INTEL),
                slice(CPU_TYPE_ARM64, 0, far, APPLE),
            ],
        );
        let file_len = far + APPLE.len() as u64;
        assert_eq!(
            fat_slice_for(&header, file_len, CPU_TYPE_ARM64),
            Some(FatSlice {
                offset: far,
                size: APPLE.len() as u64
            })
        );
        assert_eq!(fat_slice_for(&header, file_len - 1, CPU_TYPE_ARM64), None);
    }

    #[test]
    fn slice_counts_outside_one_to_sixteen_are_not_universal_binaries() {
        for magic in [FAT_MAGIC, FAT_MAGIC_64] {
            let empty = fat_header(magic, 0, &[]);
            assert_eq!(fat_slice_for(&empty, 1 << 20, CPU_TYPE_ARM64), None);

            let mut many = fat_header(magic, 17, &[]);
            for index in 0..17 {
                let one = slice(CPU_TYPE_ARM64, 0, 8192 + index * 64, APPLE);
                many.extend_from_slice(&fat_header(magic, 1, &[one])[8..]);
            }
            assert_eq!(fat_slice_for(&many, 1 << 20, CPU_TYPE_ARM64), None);

            let promised = fat_header(magic, 2, &[slice(CPU_TYPE_ARM64, 0, 8192, APPLE)]);
            assert_eq!(fat_slice_for(&promised, 1 << 20, CPU_TYPE_ARM64), None);
        }
        let java_class = [0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00, 0x00, 0x34, 0x00, 0x1d];
        assert_eq!(slice_in(&java_class, CPU_TYPE_ARM64), None);
    }

    #[test]
    fn a_universal_binary_without_the_host_cpu_has_no_slice() {
        let intel_only = universal(FAT_MAGIC, &[slice(CPU_TYPE_X86_64, 3, 4096, INTEL)]);
        assert!(slice_in(&intel_only, CPU_TYPE_X86_64).is_some());
        assert_eq!(slice_in(&intel_only, CPU_TYPE_ARM64), None);
        let both = universal(FAT_MAGIC_64, &intel_and_apple());
        assert_eq!(slice_in(&both, 0x0000_0007), None);
    }

    #[test]
    fn thin_and_short_files_are_not_universal() {
        let mut thin_arm64 = vec![0xcf, 0xfa, 0xed, 0xfe, 0x0c, 0x00, 0x00, 0x01];
        thin_arm64.resize(4096, 0);
        let files: [&[u8]; 5] = [
            &thin_arm64,
            APPLE,
            b"",
            &[0xca, 0xfe, 0xba],
            &[0xca, 0xfe, 0xba, 0xbe, 0x00, 0x00],
        ];
        for bytes in files {
            assert_eq!(slice_in(bytes, CPU_TYPE_ARM64), None, "{bytes:?}");
        }
    }

    #[test]
    fn slices_outside_the_file_or_inside_the_header_are_rejected() {
        let file = universal(FAT_MAGIC, &intel_and_apple());
        assert_eq!(
            fat_slice_for(&file, file.len() as u64 - 1, CPU_TYPE_ARM64),
            None
        );
        for bad in [
            slice(CPU_TYPE_ARM64, 0, 16, APPLE),
            slice(CPU_TYPE_ARM64, 0, 8192, b""),
            slice(CPU_TYPE_ARM64, 0, u64::MAX - 4, APPLE),
        ] {
            let header = fat_header(FAT_MAGIC_64, 1, &[bad]);
            assert_eq!(fat_slice_for(&header, u64::MAX, CPU_TYPE_ARM64), None);
        }
    }

    #[test]
    fn the_plain_slice_wins_over_arm64e_and_x86_64h() {
        let ptrauth_abi = 0x8000_0000;
        let file = universal(
            FAT_MAGIC,
            &[
                slice(
                    CPU_TYPE_ARM64,
                    CPU_SUBTYPE_ARM64E | ptrauth_abi,
                    4096,
                    b"arm64e",
                ),
                slice(CPU_TYPE_X86_64, CPU_SUBTYPE_X86_64_H, 8192, b"x86_64h"),
                slice(CPU_TYPE_ARM64, 0, 12288, APPLE),
                slice(CPU_TYPE_X86_64, 3, 16384, INTEL),
            ],
        );
        assert_eq!(slice_in(&file, CPU_TYPE_ARM64).unwrap().offset, 12288);
        assert_eq!(slice_in(&file, CPU_TYPE_X86_64).unwrap().offset, 16384);

        let only_arm64e = universal(
            FAT_MAGIC,
            &[slice(CPU_TYPE_ARM64, CPU_SUBTYPE_ARM64E, 4096, b"arm64e")],
        );
        assert_eq!(slice_in(&only_arm64e, CPU_TYPE_ARM64).unwrap().offset, 4096);
    }

    #[test]
    fn the_host_slice_is_copied_once_into_the_unpack_folder() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let texbin = directory.path().join("texbin");
        std::fs::create_dir_all(&texbin).unwrap();
        let biber = texbin.join("biber");
        std::fs::write(&biber, universal(FAT_MAGIC, &intel_and_apple())).unwrap();

        let dir = extract_host_slice(&data, &biber, CPU_TYPE_ARM64)
            .unwrap()
            .expect("a slice for arm64");

        assert_eq!(dir, unpack_dir_for(&data, &biber).unwrap().join("bin"));
        let thin = dir.join("biber");
        assert_eq!(std::fs::read(&thin).unwrap(), APPLE);
        assert_eq!(listing(&dir), vec![std::ffi::OsString::from("biber")]);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&thin).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o700);
        }

        let long_ago = std::time::SystemTime::now() - UNUSED_GRACE;
        std::fs::OpenOptions::new()
            .write(true)
            .open(&thin)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        assert_eq!(
            extract_host_slice(&data, &biber, CPU_TYPE_ARM64).unwrap(),
            Some(dir.clone())
        );
        let modified = std::fs::metadata(&thin).unwrap().modified().unwrap();
        assert_eq!(modified, long_ago);

        std::fs::write(&thin, &APPLE[..4]).unwrap();
        extract_host_slice(&data, &biber, CPU_TYPE_ARM64).unwrap();
        assert_eq!(std::fs::read(&thin).unwrap(), APPLE);
        assert_eq!(listing(&dir), vec![std::ffi::OsString::from("biber")]);
    }

    #[test]
    fn a_thin_biber_gets_no_copy() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let thin = fake_biber(&directory.path().join("app"), "tectonic-biber", 11);
        let intel_only = directory.path().join("biber");
        std::fs::write(
            &intel_only,
            universal(FAT_MAGIC, &[slice(CPU_TYPE_X86_64, 3, 4096, INTEL)]),
        )
        .unwrap();

        assert_eq!(
            extract_host_slice(&data, &thin, CPU_TYPE_ARM64).unwrap(),
            None
        );
        assert_eq!(
            extract_host_slice(&data, &intel_only, CPU_TYPE_ARM64).unwrap(),
            None
        );
        assert!(!data.exists());
        assert!(
            extract_host_slice(&data, &directory.path().join("missing"), CPU_TYPE_ARM64).is_err()
        );
    }

    #[test]
    fn only_latexmk_children_put_a_thin_biber_first_on_path() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let texbin = directory.path().join("texbin");
        std::fs::create_dir_all(&texbin).unwrap();
        let biber = texbin.join("biber");
        std::fs::write(&biber, universal(FAT_MAGIC_64, &intel_and_apple())).unwrap();
        let unpack_dir = unpack_dir_for(&data, &biber).unwrap();
        let thin_dir = unpack_dir.join("bin");

        for program in ["tectonic", "pandoc", "sh", "biber"] {
            assert_eq!(
                prepare_biber_for(&data, Path::new(program), &biber),
                Some(ChildBiber {
                    unpack_dir: unpack_dir.clone(),
                    thin_dir: None,
                }),
                "{program}"
            );
        }
        assert!(!thin_dir.exists());

        let latexmk = prepare_biber_for(&data, &texbin.join("latexmk"), &biber).unwrap();
        let runs_thin = cfg!(target_os = "macos") && host_cpu_type().is_some();
        assert_eq!(latexmk.unpack_dir, unpack_dir);
        assert_eq!(latexmk.thin_dir.is_some(), runs_thin);
        assert_eq!(thin_dir.join("biber").is_file(), runs_thin);
        if let Some(dir) = &latexmk.thin_dir {
            assert_eq!(dir, &thin_dir);
        }
    }

    #[test]
    fn the_thin_biber_folder_goes_first_on_the_child_path() {
        let directory = tempfile::tempdir().unwrap();
        let thin = directory.path().join("bin");
        let texbin = directory.path().join("texbin");
        let usr = directory.path().join("usr");
        let inherited = std::env::join_paths([texbin.clone(), thin.clone(), usr.clone()]).unwrap();
        let without = ChildBiber {
            unpack_dir: directory.path().to_path_buf(),
            thin_dir: None,
        };
        let with = ChildBiber {
            thin_dir: Some(thin.clone()),
            ..without.clone()
        };

        assert_eq!(without.path_env(&inherited), inherited);
        assert_eq!(
            std::env::split_paths(&with.path_env(&inherited)).collect::<Vec<_>>(),
            vec![thin, texbin, usr]
        );
    }

    #[test]
    fn pruning_keeps_the_unpacks_in_use_and_removes_everything_else() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let outside = directory.path().join("outside");
        let current = root.join("0a1b2c3d").join("par-6f6c").join("cache-1");
        let system = root.join("5e6f7a8b").join("par-6f6c").join("cache-4");
        let upgraded = root.join("9f8e7d6c").join("par-6f6c").join("cache-2");
        let flat = root.join("par-6f6c").join("cache-3").join("inc");
        for dir in [&current, &system, &upgraded, &flat] {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::write(dir.join("x.pm"), b"x").unwrap();
        }
        std::fs::write(root.join("stray.txt"), b"stray").unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::fs::write(outside.join("keep-me.txt"), b"outside").unwrap();

        let outcome = prune_unpack_root(
            &root,
            &keeping(&["0a1b2c3d", "5e6f7a8b"]),
            after_the_grace_period(),
        );

        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(outcome.removed, 3);
        let mut left: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                std::ffi::OsString::from("0a1b2c3d"),
                std::ffi::OsString::from("5e6f7a8b")
            ]
        );
        assert!(current.join("x.pm").is_file());
        assert!(system.join("x.pm").is_file());
        assert!(outside.join("keep-me.txt").is_file());
    }

    #[test]
    fn pruning_spares_unpacks_another_instance_used_recently() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let later = after_the_grace_period();
        let hour = std::time::Duration::from_secs(3600);
        for name in ["busy", "idle", "skewed", "far-future", "fresh", "no-marker"] {
            std::fs::create_dir_all(root.join(name).join("par-6f6c")).unwrap();
        }
        age_marker(&root.join("busy"), later - UNUSED_GRACE + hour);
        age_marker(&root.join("idle"), later - UNUSED_GRACE - hour);
        age_marker(&root.join("skewed"), later + hour);
        age_marker(&root.join("far-future"), later + UNUSED_GRACE * 2);
        age_marker(&root.join("fresh"), std::time::SystemTime::now());

        let outcome = prune_unpack_root(&root, &[], later);

        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        let mut left: Vec<_> = std::fs::read_dir(&root)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        left.sort();
        assert_eq!(
            left,
            vec![
                std::ffi::OsString::from("busy"),
                std::ffi::OsString::from("skewed")
            ]
        );
        assert_eq!(outcome.removed, 4);
    }

    #[test]
    fn pruning_right_after_use_removes_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        for name in ["fresh", "no-marker"] {
            std::fs::create_dir_all(root.join(name).join("par-6f6c")).unwrap();
        }
        std::fs::write(root.join("stray.txt"), b"stray").unwrap();
        age_marker(&root.join("fresh"), std::time::SystemTime::now());

        let outcome = prune_unpack_root(&root, &[], std::time::SystemTime::now());

        assert_eq!(outcome.removed, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 3);
    }

    #[test]
    fn entries_another_instance_already_removed_are_not_failures() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let gone = root.join("9f8e7d6c");
        let mut outcome = PruneOutcome::default();
        outcome.record(&gone, retire_unpack_entry(&gone, &standard_rename));
        assert_eq!(outcome.removed, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);

        unpacked_tree(&root.join("5e6f7a8b"));
        let swept_elsewhere =
            prune_unpack_root_with(&root, &[], after_the_grace_period(), |from, to| {
                std::fs::rename(from, to)?;
                std::fs::remove_dir_all(to)
            });

        assert!(
            swept_elsewhere.failures.is_empty(),
            "{:?}",
            swept_elsewhere.failures
        );
        assert_eq!(swept_elsewhere.removed, 1);
        assert!(listing(&root).is_empty());
    }

    #[test]
    fn tombstones_are_hidden_siblings_that_never_look_like_an_unpack_folder() {
        let directory = tempfile::tempdir().unwrap();
        let live = directory.path().join("0a1b2c3d");
        let first = unused_tombstone_for(&live).unwrap();
        std::fs::create_dir_all(&first).unwrap();
        let second = unused_tombstone_for(&live).unwrap();

        for tombstone in [&first, &second] {
            assert_eq!(tombstone.parent(), live.parent());
            let name = tombstone.file_name().unwrap();
            assert!(is_tombstone(name), "{name:?}");
            assert!(name.to_string_lossy().starts_with(".0a1b2c3d.deleting-"));
        }
        assert_ne!(first, second);
        for name in [
            "0a1b2c3d",
            "par-6f6c",
            ".last-used",
            ".DS_Store",
            ".0a1b2c3d.deleting-",
            ".0a1b2c3d.deleting-12-",
            ".0a1b2c3d.deleting-a-1",
            "0a1b2c3d.deleting-12-0",
        ] {
            assert!(!is_tombstone(std::ffi::OsStr::new(name)), "{name}");
        }
    }

    #[test]
    fn a_tombstone_left_by_an_interrupted_prune_is_removed_next_time() {
        let directory = tempfile::tempdir().unwrap();
        let data = directory.path().join("data");
        let root = unpack_root(&data);
        let biber = fake_biber(&directory.path().join("bin"), "biber", 10);
        let stale = unpack_dir_for(&data, &biber).unwrap();
        let files = unpacked_tree(&stale);
        let canary = files[0].strip_prefix(&stale).unwrap().to_path_buf();
        let lost = files[1].strip_prefix(&stale).unwrap().to_path_buf();
        let later = after_the_grace_period();

        let interrupted = prune_unpack_root_with(&root, &[], later, |from, to| {
            std::fs::rename(from, to)?;
            std::fs::remove_file(to.join(&lost))?;
            Err(std::io::ErrorKind::Interrupted.into())
        });

        assert_eq!(interrupted.removed, 0);
        assert_eq!(interrupted.failures.len(), 1, "{:?}", interrupted.failures);
        assert!(std::fs::symlink_metadata(&stale).is_err());
        let left = listing(&root);
        assert_eq!(left.len(), 1, "{left:?}");
        assert!(is_tombstone(&left[0]), "{left:?}");
        let tombstone = root.join(&left[0]);
        assert!(tombstone.join(&canary).is_file());
        assert!(!tombstone.join(&lost).exists());

        let revived = prepare_unpack_dir(&data, &biber).unwrap();
        assert_eq!(revived, stale);
        assert_eq!(
            listing(&revived),
            vec![std::ffi::OsString::from(LAST_USED_MARKER)]
        );
        age_marker(&tombstone, std::time::SystemTime::now());

        let next = prune_unpack_root(&root, &[], std::time::SystemTime::now());

        assert!(next.failures.is_empty(), "{:?}", next.failures);
        assert_eq!(next.removed, 1);
        assert_eq!(
            listing(&root),
            vec![revived.file_name().unwrap().to_owned()]
        );
        assert!(revived.join(LAST_USED_MARKER).is_file());
    }

    #[test]
    fn a_stale_folder_whose_rename_fails_is_left_intact() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let stale = root.join("9f8e7d6c");
        let files = unpacked_tree(&stale);
        let before = snapshot(&stale);

        let outcome = prune_unpack_root_with(&root, &[], after_the_grace_period(), |_, _| {
            Err(std::io::ErrorKind::PermissionDenied.into())
        });

        assert_eq!(outcome.removed, 0);
        assert_eq!(outcome.failures.len(), 1, "{:?}", outcome.failures);
        assert!(outcome.failures[0].contains("9f8e7d6c"));
        for file in &files {
            assert!(file.is_file(), "{}", file.display());
        }
        assert_eq!(snapshot(&stale), before);
        assert_eq!(listing(&root), vec![std::ffi::OsString::from("9f8e7d6c")]);
    }

    #[test]
    fn the_live_fingerprint_folder_is_never_renamed_or_touched() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let live = root.join("0a1b2c3d");
        let stale = root.join("9f8e7d6c");
        unpacked_tree(&live);
        unpacked_tree(&stale);
        age_marker(&live, std::time::SystemTime::now() - UNUSED_GRACE * 4);
        let leftover = root.join(format!(".0a1b2c3d{TOMBSTONE_MARK}1-0"));
        unpacked_tree(&leftover);
        age_marker(&leftover, after_the_grace_period());
        if crate::paths::symlink_creation_is_permitted() {
            link_dir(&live, &root.join(format!(".0a1b2c3d{TOMBSTONE_MARK}2-0")));
        }
        let before = snapshot(&live);
        let renamed = std::sync::Mutex::new(Vec::new());

        let outcome = prune_unpack_root_with(
            &root,
            &keeping(&["0a1b2c3d"]),
            after_the_grace_period(),
            |from, to| {
                renamed.lock().unwrap().push(from.to_path_buf());
                std::fs::rename(from, to)
            },
        );

        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(renamed.into_inner().unwrap(), vec![stale]);
        assert_eq!(snapshot(&live), before);
        assert_eq!(listing(&root), vec![std::ffi::OsString::from("0a1b2c3d")]);
    }

    #[test]
    fn pruning_removes_links_without_following_them() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("biber");
        let outside = directory.path().join("outside");
        std::fs::create_dir_all(root.join("0a1b2c3d")).unwrap();
        std::fs::create_dir_all(root.join("old")).unwrap();
        std::fs::create_dir_all(outside.join("nested")).unwrap();
        std::fs::write(outside.join("nested").join("data.txt"), b"outside").unwrap();
        std::fs::write(outside.join("file.txt"), b"outside").unwrap();
        let later = after_the_grace_period();
        age_marker(&outside, later);
        std::fs::OpenOptions::new()
            .write(true)
            .open(outside.join("file.txt"))
            .unwrap()
            .set_modified(later)
            .unwrap();
        link_dir(&outside, &root.join("dir-link"));
        link_file(&outside.join("file.txt"), &root.join("file-link"));
        link_dir(&outside, &root.join("old").join("escape"));
        assert!(used_within_grace(&outside, later));
        assert!(used_within_grace(&outside.join("file.txt"), later));

        let outcome = prune_unpack_root(&root, &keeping(&["0a1b2c3d"]), later);

        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert_eq!(outcome.removed, 3);
        assert!(std::fs::symlink_metadata(root.join("dir-link")).is_err());
        assert!(std::fs::symlink_metadata(root.join("file-link")).is_err());
        assert!(!root.join("old").exists());
        assert_eq!(listing(&root), vec![std::ffi::OsString::from("0a1b2c3d")]);
        assert!(outside.join("nested").join("data.txt").is_file());
        assert!(outside.join("file.txt").is_file());
        assert!(outside.join(LAST_USED_MARKER).is_file());
    }

    #[test]
    fn pruning_a_linked_root_leaves_the_link_target_alone() {
        if !crate::paths::symlink_creation_is_permitted() {
            return;
        }
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("elsewhere");
        std::fs::create_dir_all(target.join("old")).unwrap();
        let root = directory.path().join("biber");
        link_dir(&target, &root);

        let outcome = prune_unpack_root(&root, &keeping(&["0a1b2c3d"]), after_the_grace_period());

        assert_eq!(outcome.removed, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert!(target.join("old").is_dir());
    }

    #[test]
    fn pruning_a_missing_root_does_nothing() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("assets").join("biber");

        let outcome = prune_unpack_root(&root, &keeping(&["0a1b2c3d"]), after_the_grace_period());

        assert_eq!(outcome.removed, 0);
        assert!(outcome.failures.is_empty(), "{:?}", outcome.failures);
        assert!(!root.exists());
        assert!(!directory.path().join("assets").exists());
    }

    #[test]
    fn the_session_prune_works_in_the_data_root_and_keeps_what_is_in_use() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let data = tempfile::tempdir().unwrap();
        let previous = std::env::var_os("OLEAFLY_DATA_DIR");
        std::env::set_var("OLEAFLY_DATA_DIR", data.path());
        let root = unpack_root(data.path());
        let idle = root.join("0badf00d");
        std::fs::create_dir_all(idle.join("par-6f6c").join("cache-1")).unwrap();
        age_marker(&idle, std::time::SystemTime::now() - UNUSED_GRACE * 2);
        let system = fake_biber(&data.path().join("texbin"), "biber", 9);
        let in_use = prepare_unpack_dir(data.path(), &system).expect("created");
        let installed: Vec<PathBuf> = bibers_in_use()
            .iter()
            .map(|biber| {
                let dir = prepare_unpack_dir(data.path(), biber).expect("created");
                age_marker(&dir, std::time::SystemTime::now() - UNUSED_GRACE * 2);
                dir
            })
            .collect();

        prune_stale_unpacks();

        match previous {
            Some(value) => std::env::set_var("OLEAFLY_DATA_DIR", value),
            None => std::env::remove_var("OLEAFLY_DATA_DIR"),
        }
        assert!(!idle.exists());
        assert!(listing(&root).iter().all(|name| !is_tombstone(name)));
        assert!(in_use.is_dir());
        for dir in installed {
            assert!(dir.is_dir(), "{}", dir.display());
        }
    }

    #[test]
    fn the_bibers_in_use_include_the_one_compiles_would_run() {
        let tools = tempfile::tempdir().unwrap();
        let project = tempfile::tempdir().unwrap();
        let compiled = |program: &Path| {
            biber_for_child(program, &compile_path_env_for(program, project.path()))
        };
        let biber = executable_biber(tools.path());
        let latexmk = tools.path().join(crate::tex_distro::exe("latexmk"));
        let tectonic = tools.path().join(crate::tex_distro::exe("tectonic"));
        for program in [&latexmk, &tectonic] {
            std::fs::write(program, b"").unwrap();
        }
        let fakes = [latexmk.clone(), tectonic];
        let kept = bibers_for_programs(&fakes);

        assert_eq!(compiled(&latexmk), Some(biber.clone()));
        for program in &fakes {
            let chosen = compiled(program).expect("a Biber sits in the preferred directory");
            assert!(
                kept.contains(&chosen),
                "{program:?} runs {chosen:?}, kept {kept:?}"
            );
        }

        let installed = bibers_in_use();
        let resolved = [
            find_tectonic_biber(),
            crate::document_engine::resolve_bundled_sidecar("tectonic").ok(),
            crate::tex_distro::find_tex_tool("latexmk"),
        ];
        for program in resolved.iter().flatten() {
            if let Some(chosen) = compiled(program) {
                assert!(
                    installed.contains(&chosen),
                    "{program:?} runs {chosen:?}, kept {installed:?}"
                );
            }
        }
    }

    fn executable_biber(dir: &Path) -> PathBuf {
        let path = dir.join(crate::tex_distro::exe("biber"));
        std::fs::write(&path, b"#!/bin/sh\nexit 0\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        path
    }

    fn unpacked_tree(dir: &Path) -> Vec<PathBuf> {
        let cache = dir.join("par-6f6c").join("cache-1");
        let files = vec![
            cache.join("_CANARY_.txt"),
            cache
                .join("inc")
                .join("lib")
                .join("Biber")
                .join("LaTeX")
                .join("recode_data.xml"),
            cache.join("inc").join("lib").join("Biber.pm"),
        ];
        for file in &files {
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, b"x").unwrap();
        }
        files
    }

    fn listing(dir: &Path) -> Vec<std::ffi::OsString> {
        let mut names: Vec<_> = std::fs::read_dir(dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        names.sort();
        names
    }

    fn snapshot(dir: &Path) -> Vec<(PathBuf, u64, Option<std::time::SystemTime>)> {
        let mut entries = Vec::new();
        let mut pending = vec![dir.to_path_buf()];
        while let Some(path) = pending.pop() {
            let metadata = std::fs::symlink_metadata(&path).unwrap();
            if metadata.is_dir() {
                pending.extend(
                    std::fs::read_dir(&path)
                        .unwrap()
                        .map(|entry| entry.unwrap().path()),
                );
            }
            entries.push((
                path.strip_prefix(dir).unwrap().to_path_buf(),
                metadata.len(),
                metadata.modified().ok(),
            ));
        }
        entries.sort();
        entries
    }

    fn standard_rename(from: &Path, to: &Path) -> std::io::Result<()> {
        std::fs::rename(from, to)
    }

    #[cfg(unix)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_dir(target: &Path, link: &Path) {
        std::os::windows::fs::symlink_dir(target, link).unwrap();
    }

    #[cfg(unix)]
    fn link_file(target: &Path, link: &Path) {
        std::os::unix::fs::symlink(target, link).unwrap();
    }

    #[cfg(windows)]
    fn link_file(target: &Path, link: &Path) {
        std::os::windows::fs::symlink_file(target, link).unwrap();
    }

    fn scratch_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "oleafly-biber-test-{}-{}",
            label,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn diagnose_mode_a_when_biber_missing() {
        let msg = diagnose_biber_gap(
            "note: Running external tool biber ...\nerror: No such file or directory (os error 2)",
            None,
        );
        assert!(msg.contains("mode A"));
        assert!(msg.contains("not found"));
    }

    #[test]
    fn diagnose_mode_b_on_version_skew() {
        let msg = diagnose_biber_gap(
            "ERROR - Error: Found biblatex control file version 3.8, expected version 3.11.\n\
This means that your biber (2.20) and biblatex (3.17) versions are incompatible.",
            Some(Path::new("/Library/TeX/texbin/biber")),
        );
        assert!(msg.contains("mode B"));
        assert!(msg.contains("version mismatch"));
    }

    #[test]
    fn compile_path_env_is_non_empty() {
        let env = compile_path_env();
        assert!(!env.is_empty());
    }

    #[test]
    fn compiler_path_drops_current_directory_and_relative_entries() {
        let directory = tempfile::tempdir().unwrap();
        let absolute = directory.path().to_owned();
        let inherited = std::env::join_paths([PathBuf::from("."), absolute.clone()]).unwrap();
        let hardened = compile_path_env_with_inherited(Some(&inherited), None, None);
        let entries: Vec<_> = std::env::split_paths(&hardened).collect();
        assert!(entries.iter().all(|entry| entry.is_absolute()));
        assert!(entries.contains(&absolute));
        assert!(!entries.contains(&PathBuf::from(".")));
    }

    #[test]
    fn compiler_path_prefers_selected_distribution_and_excludes_project() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let project_bin = root.join("project/bin");
        let distro_a = root.join("distro-a/bin");
        let distro_b = root.join("distro-b/bin");
        std::fs::create_dir_all(&project_bin).unwrap();
        std::fs::create_dir_all(&distro_a).unwrap();
        std::fs::create_dir_all(&distro_b).unwrap();
        let inherited = std::env::join_paths([project_bin.clone(), distro_a.clone()]).unwrap();
        let preferred = distro_b.join(crate::tex_distro::exe("latexmk"));
        let hardened = compile_path_env_with_inherited(
            Some(&inherited),
            preferred.parent(),
            Some(&root.join("project")),
        );
        let entries: Vec<_> = std::env::split_paths(&hardened).collect();
        assert_eq!(entries.first(), Some(&distro_b));
        assert!(entries.contains(&distro_a));
        assert!(!entries.contains(&project_bin));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn biber_cli_args_target_out_dir_and_entry_stem() {
        let args = biber_cli_args(Path::new("/build"), "_oleafly_entry");
        assert_eq!(
            args,
            [
                "--output-directory",
                "/build",
                "--input-directory",
                "/build",
                "_oleafly_entry"
            ]
        );
    }

    const FULL_BBL: &str = "% $ biblatex auxiliary file $\n\\refsection{0}\n\\datalist[entry]{none/global//global/global}\n\\entry{miles2004laddering}{article}{}\n\\enddatalist\n\\endrefsection\n\\endinput\n";

    #[test]
    fn bbl_refreshed_compares_against_the_stamp_taken_before_the_compile() {
        let dir = scratch_dir("stamp");
        assert!(bbl_stamp(&dir, "main").is_none());
        assert!(!bbl_refreshed(&dir, "main", None));
        std::fs::write(dir.join("main.bbl"), b"").unwrap();
        assert!(!bbl_refreshed(&dir, "main", None));
        std::fs::write(dir.join("main.bbl"), FULL_BBL).unwrap();
        assert!(bbl_refreshed(&dir, "main", None));
        let before = bbl_stamp(&dir, "main");
        assert!(!bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.bbl"),
            format!(
                "{FULL_BBL}
"
            ),
        )
        .unwrap();
        assert!(bbl_refreshed(&dir, "main", before));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_fresh_biber_log_proves_the_bbl_was_written_even_with_an_unchanged_stamp() {
        let dir = scratch_dir("blg-evidence");
        std::fs::write(dir.join("main.bbl"), FULL_BBL).unwrap();
        let before = bbl_stamp(&dir, "main");
        assert!(!bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.blg"),
            "[0] Config.pm:310> INFO - Logfile is 'main.blg'\r\n[118] bbl.pm:654> INFO - Writing 'main.bbl' with encoding 'UTF-8'\r\n[118] bbl.pm:757> INFO - Output to main.bbl\r\n",
        )
        .unwrap();
        assert!(bbl_refreshed(&dir, "main", before));
        std::fs::write(
            dir.join("main.blg"),
            "[0] Config.pm:310> INFO - Logfile is 'main.blg'\nERROR - Cannot find 'refs.bib'!\n",
        )
        .unwrap();
        assert!(!bbl_refreshed(&dir, "main", before));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diagnose_mode_c_when_biber_cannot_find_the_bib_file() {
        let msg = diagnose_biber_gap(
            "INFO - Reading '_oleafly_entry.bcf'\nERROR - Cannot find 'references.bib'!",
            Some(Path::new("/app/tectonic-biber")),
        );
        assert!(msg.contains("mode C"));
        assert!(msg.contains("references.bib"));
        assert!(msg.contains("addbibresource"));
    }

    #[test]
    fn biber_message_excerpt_keeps_errors_and_warnings_only() {
        let excerpt = biber_message_excerpt(
            "[0] Config.pm:307> INFO - This is Biber 2.17\r\n[122] Biber.pm:130> WARN - I didn't find a database entry for 'x' (section 0)\r\nINFO - Writing 'main.bbl'\nERROR - Cannot find 'refs.bib'!\n",
        );
        assert_eq!(
            excerpt,
            "WARN - I didn't find a database entry for 'x' (section 0)\nERROR - Cannot find 'refs.bib'!\n"
        );
        assert_eq!(biber_message_excerpt("INFO - fine\n"), "");
    }
}
