//! The environment a TeX compile needs for the pinned Biber: the folder
//! PAR::Packer unpacks Biber into (`PAR_GLOBAL_TMPDIR`, one per Biber build,
//! named after its fingerprint) and the compile's `PATH`.
use std::ffi::{OsStr, OsString};
use std::path::{Path, PathBuf};

pub const UNPACK_ENV: &str = "PAR_GLOBAL_TMPDIR";
pub const LAST_USED_MARKER: &str = ".last-used";
/// Set when Oleafly starts Biber itself. Tectonic builds Biber's command line
/// from what the document writes, so the patched Biber ignores options without
/// this (see `scripts/biber/harden-biber.mjs`).
pub const DIRECT_ENV: &str = "OLEAFLY_BIBER_DIRECT";
pub const FINGERPRINT_SAMPLE_BYTES: u64 = 1024 * 1024;

const MAX_EXCERPT_MESSAGES: usize = 40;

pub fn strip_biber_log_prefix(line: &str) -> &str {
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

pub fn biber_message_excerpt(log: &str) -> String {
    let mut excerpt = String::new();
    let mut source = None;
    let mut messages = 0;
    for line in log
        .lines()
        .map(|line| strip_biber_log_prefix(line).trim_end_matches('\r'))
    {
        if line.starts_with("INFO - Found BibTeX data source") {
            source = Some(line);
            continue;
        }
        if !line.starts_with("WARN - ") && !line.starts_with("ERROR - ") {
            continue;
        }
        if messages == MAX_EXCERPT_MESSAGES {
            break;
        }
        messages += 1;
        if let Some(source) = source.filter(|_| line.starts_with("ERROR - BibTeX subsystem")) {
            excerpt.push_str(source);
            excerpt.push('\n');
        }
        excerpt.push_str(line);
        excerpt.push('\n');
    }
    excerpt
}

pub fn unpack_base(data_root: &Path) -> PathBuf {
    let program_data = std::env::var_os("PROGRAMDATA").map(PathBuf::from);
    crate::tex_distro::managed_tinytex_parent_for(
        std::env::consts::OS,
        Some(data_root),
        program_data.as_deref(),
    )
    .unwrap_or_else(|| data_root.to_owned())
}

pub fn unpack_root(data_root: &Path) -> PathBuf {
    unpack_base(data_root).join("assets").join("biber")
}

pub fn unpack_dir_for(data_root: &Path, biber: &Path) -> Option<PathBuf> {
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

pub fn stamp_last_use(dir: &Path, when: std::time::SystemTime) -> std::io::Result<()> {
    std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(dir.join(LAST_USED_MARKER))?
        .set_modified(when)
}

/// `tectonic-biber` in `dir`, the name Tectonic looks for first.
pub fn tectonic_biber_in(dir: &Path) -> Option<PathBuf> {
    crate::sidecar::sidecar_in(dir, "tectonic-biber")
}

type FingerprintCache =
    std::collections::HashMap<PathBuf, (u64, Option<std::time::SystemTime>, String)>;

pub fn fingerprint(path: &Path) -> Option<String> {
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

pub fn binary_fingerprint(path: &Path) -> std::io::Result<String> {
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

pub fn push_unique(dirs: &mut Vec<PathBuf>, dir: PathBuf) {
    if !dirs.iter().any(|existing| existing == &dir) {
        dirs.push(dir);
    }
}

pub fn path_is_within(path: &Path, root: &Path) -> bool {
    let resolved_path = resolve_existing_part(path);
    let resolved_root = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
    resolved_path == resolved_root || resolved_path.starts_with(&resolved_root)
}

fn resolve_existing_part(path: &Path) -> PathBuf {
    let mut missing = Vec::new();
    let mut current = path;
    loop {
        if let Ok(real) = current.canonicalize() {
            return missing
                .iter()
                .rev()
                .fold(real, |resolved, part| resolved.join(part));
        }
        match (current.parent(), current.file_name()) {
            (Some(parent), Some(name)) => {
                missing.push(name.to_os_string());
                current = parent;
            }
            _ => return path.to_path_buf(),
        }
    }
}

pub fn compile_path_env(
    preferred_dir: Option<&Path>,
    extra_dirs: &[PathBuf],
    inherited: Option<&OsStr>,
    excluded_root: Option<&Path>,
) -> OsString {
    let mut dirs = Vec::new();
    let mut add = |dir: PathBuf| {
        if dir.is_absolute() && !excluded_root.is_some_and(|root| path_is_within(&dir, root)) {
            push_unique(&mut dirs, dir);
        }
    };
    if let Some(preferred) = preferred_dir {
        add(preferred.to_path_buf());
    }
    for dir in extra_dirs {
        add(dir.clone());
    }
    if let Some(inherited) = inherited {
        for dir in std::env::split_paths(inherited) {
            add(dir);
        }
    }
    std::env::join_paths(dirs).unwrap_or_default()
}

pub fn path_with_first(dir: &Path, path_env: &OsStr) -> OsString {
    let rest = std::env::split_paths(path_env).filter(|entry| entry != dir);
    std::env::join_paths(std::iter::once(dir.to_path_buf()).chain(rest))
        .unwrap_or_else(|_| path_env.to_os_string())
}

pub fn first_biber_on(path_env: &OsStr) -> Option<PathBuf> {
    std::env::split_paths(path_env)
        .filter(|dir| dir.is_absolute())
        .find_map(|dir| crate::tex_distro::find_tool_in_dir(&dir, "biber"))
}

const THIN_BIBER_DIR: &str = "bin";

const THIN_BIBER_NAME: &str = "biber";

const THIN_BIBER_RC: &str = "latexmkrc";

pub const FAT_MAGIC: u32 = 0xcafe_babe;

pub const FAT_MAGIC_64: u32 = 0xcafe_babf;

const FAT_ARCH_LEN: usize = 20;

const FAT_ARCH_64_LEN: usize = 32;

const MAX_FAT_SLICES: u32 = 16;

const FAT_HEADER_MAX: u64 = 8 + MAX_FAT_SLICES as u64 * FAT_ARCH_64_LEN as u64;

pub const CPU_TYPE_X86_64: u32 = 0x0100_0007;

pub const CPU_TYPE_ARM64: u32 = 0x0100_000c;

const CPU_SUBTYPE_MASK: u32 = 0xff00_0000;

pub const CPU_SUBTYPE_ARM64E: u32 = 2;

pub const CPU_SUBTYPE_X86_64_H: u32 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FatSlice {
    pub offset: u64,
    pub size: u64,
}

pub fn host_cpu_type() -> Option<u32> {
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
pub fn runnable_biber_dir(data_root: &Path, biber: &Path) -> std::io::Result<Option<PathBuf>> {
    if !cfg!(target_os = "macos") {
        return Ok(None);
    }
    match host_cpu_type() {
        Some(cpu_type) => extract_host_slice(data_root, biber, cpu_type),
        None => Ok(None),
    }
}

pub fn extract_host_slice(
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
        staged
            .as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o700))?;
    }
    staged.persist(&thin).map_err(|error| error.error)?;
    Ok(Some(dir))
}

fn latexmk_biber_rc(thin_dir: &Path) -> Option<String> {
    let biber = thin_dir.join(THIN_BIBER_NAME);
    let biber = biber.to_str()?;
    if biber.contains(['"', '\\', '$', '`', '{', '}', '%', '\n']) {
        return None;
    }
    Some(format!(
        "$biber = q{{\"{biber}\" %O %S}};\nread_first_rc_file_in_list(@rc_system_files[1 .. $#rc_system_files]) if defined &read_first_rc_file_in_list;\n"
    ))
}

pub fn write_latexmk_biber_rc(thin_dir: &Path) -> std::io::Result<Option<PathBuf>> {
    let Some(text) = latexmk_biber_rc(thin_dir) else {
        return Ok(None);
    };
    let rc = thin_dir.join(THIN_BIBER_RC);
    if !std::fs::read_to_string(&rc).is_ok_and(|current| current == text) {
        crate::atomic::write_atomic(&rc, text.as_bytes())?;
    }
    Ok(Some(rc))
}

pub fn fat_slice_for(header: &[u8], file_len: u64, cpu_type: u32) -> Option<FatSlice> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_folder_moves_to_the_front_of_the_path_once() {
        let directory = tempfile::tempdir().unwrap();
        let thin = directory.path().join("bin");
        let texbin = directory.path().join("texbin");
        let path = std::env::join_paths([texbin.clone(), thin.clone()]).unwrap();
        assert_eq!(
            std::env::split_paths(&path_with_first(&thin, &path)).collect::<Vec<_>>(),
            vec![thin, texbin]
        );
    }

    #[test]
    fn the_first_biber_on_an_absolute_path_entry_wins() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("first");
        let second = directory.path().join("second");
        let name = format!("biber{}", std::env::consts::EXE_SUFFIX);
        for folder in [&first, &second] {
            std::fs::create_dir_all(folder).unwrap();
            std::fs::write(folder.join(&name), b"biber").unwrap();
        }
        let path = std::env::join_paths([
            PathBuf::from("relative"),
            directory.path().join("empty"),
            second.clone(),
            first,
        ])
        .unwrap();
        assert_eq!(first_biber_on(&path), Some(second.join(&name)));
        assert_eq!(
            first_biber_on(&std::env::join_paths([directory.path()]).unwrap()),
            None
        );
    }

    #[cfg(unix)]
    #[test]
    fn the_latexmk_rc_names_the_thin_biber_and_keeps_the_system_rc_files() {
        let directory = tempfile::tempdir().unwrap();
        let thin = directory
            .path()
            .join("Application Support 한글")
            .join("bin");
        std::fs::create_dir_all(&thin).unwrap();
        let rc = write_latexmk_biber_rc(&thin).unwrap().unwrap();
        assert_eq!(rc, thin.join("latexmkrc"));
        let text = std::fs::read_to_string(&rc).unwrap();
        assert!(text.starts_with(&format!(
            "$biber = q{{\"{}\" %O %S}};\n",
            thin.join("biber").display()
        )));
        assert!(text.contains("@rc_system_files[1 .. $#rc_system_files]"));
        assert_eq!(write_latexmk_biber_rc(&thin).unwrap(), Some(rc));
    }

    #[test]
    fn a_path_perl_or_the_shell_would_read_differently_gets_no_rc() {
        for folder in ["a\"b", "a\\b", "a$b", "a`b", "a{b", "a}b", "a%b", "a\nb"] {
            assert_eq!(latexmk_biber_rc(Path::new(folder)), None, "{folder}");
        }
        assert!(latexmk_biber_rc(Path::new("Application Support")).is_some());
    }

    #[test]
    fn the_excerpt_names_the_bib_file_only_beside_its_syntax_error() {
        let log = concat!(
            "[0] Config.pm:311> INFO - This is Biber 2.17\n",
            "[5] Biber.pm:4420> INFO - Found BibTeX data source 'refs.bib'\r\n",
            "[6] Utils.pm:1> ERROR - BibTeX subsystem: /tmp/biber_tmp/a.utf8, line 9, syntax error: at end of input\n",
            "[7] Biber.pm:1> INFO - ERRORS: 1\n",
        );
        assert_eq!(
            biber_message_excerpt(log),
            "INFO - Found BibTeX data source 'refs.bib'\nERROR - BibTeX subsystem: /tmp/biber_tmp/a.utf8, line 9, syntax error: at end of input\n"
        );
        let clean = "[5] Biber.pm:4420> INFO - Found BibTeX data source 'refs.bib'\n[6] Biber.pm:1> INFO - Output to main.bbl\n";
        assert_eq!(biber_message_excerpt(clean), "");
    }

    #[test]
    fn each_biber_unpacks_into_a_folder_named_after_its_fingerprint() {
        let data = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let one = tools.path().join("biber-one");
        let two = tools.path().join("biber-two");
        std::fs::write(&one, b"first build").unwrap();
        std::fs::write(&two, b"second build").unwrap();
        let first = prepare_unpack_dir(data.path(), &one).unwrap();
        let second = prepare_unpack_dir(data.path(), &two).unwrap();
        assert_ne!(first, second);
        assert!(first.starts_with(unpack_root(data.path())));
        assert!(first.join(LAST_USED_MARKER).is_file());
        assert_eq!(binary_fingerprint(&one).unwrap().len(), 8);
    }

    #[test]
    fn compile_path_env_skips_project_dirs_and_duplicates() {
        let project = tempfile::tempdir().unwrap();
        let tools = tempfile::tempdir().unwrap();
        let preferred = tools.path().join("engine");
        let extra = tools.path().join("tex");
        std::fs::create_dir_all(&preferred).unwrap();
        std::fs::create_dir_all(&extra).unwrap();
        let inherited = std::env::join_paths([
            project.path().join("bin"),
            extra.clone(),
            tools.path().join("other"),
        ])
        .unwrap();
        let value = compile_path_env(
            Some(&preferred),
            std::slice::from_ref(&extra),
            Some(&inherited),
            Some(project.path()),
        );
        let entries: Vec<PathBuf> = std::env::split_paths(&value).collect();
        assert_eq!(entries, vec![preferred, extra, tools.path().join("other")]);
    }
}
