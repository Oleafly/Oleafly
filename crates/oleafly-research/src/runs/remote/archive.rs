//! The task workspace as a streamed `tar.gz` for remote runs, and the files a
//! run created, unpacked without ever leaving the destination folder.
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};

use cap_fs_ext::{FollowSymlinks, OpenOptionsFollowExt};
use flate2::read::GzDecoder;
use flate2::write::GzEncoder;
use flate2::Compression;

use crate::runs::RunError;

/// Folders a remote run never needs (`runs` holds earlier runs' outputs).
pub const UPLOAD_EXCLUDES: &[&str] = &[
    ".git",
    ".oleafly",
    "runs",
    "__pycache__",
    ".venv",
    "venv",
    "node_modules",
];
/// Excluded at any depth; the rest only at the top.
const EXCLUDED_ANYWHERE: &[&str] = &["__pycache__", "node_modules"];
const PIPE_BYTES: usize = 256 * 1024;
const MAX_LISTED: usize = 200;

#[derive(Clone, Copy, Debug)]
pub struct PackLimits {
    pub max_file: u64,
    pub max_total: u64,
    pub max_files: usize,
}

impl Default for PackLimits {
    fn default() -> Self {
        Self {
            max_file: 64 * 1024 * 1024,
            max_total: 2 * 1024 * 1024 * 1024,
            max_files: 20_000,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PackSummary {
    pub files: usize,
    pub bytes: u64,
    pub skipped: Vec<String>,
}

fn note_skipped(list: &mut Vec<String>, name: String) {
    if list.len() < MAX_LISTED {
        list.push(name);
    }
}

fn excluded(relative: &str, name: &str) -> bool {
    let top = !relative.contains('/');
    EXCLUDED_ANYWHERE.contains(&name) || (top && UPLOAD_EXCLUDES.contains(&name))
}

fn mtime(metadata: &std::fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

#[cfg(unix)]
fn file_mode(metadata: &std::fs::Metadata) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    if metadata.permissions().mode() & 0o111 != 0 {
        0o755
    } else {
        0o644
    }
}

#[cfg(not(unix))]
fn file_mode(_metadata: &std::fs::Metadata) -> u32 {
    0o644
}

struct Packer<W: Write> {
    builder: tar::Builder<GzEncoder<W>>,
    limits: PackLimits,
    summary: PackSummary,
}

fn too_large(limits: &PackLimits) -> RunError {
    RunError::Invalid(format!(
        "The workspace is too large to send: runs on another computer take up to {} files and {} GiB. Keep large data on that computer and read it from there.",
        limits.max_files,
        limits.max_total / (1024 * 1024 * 1024)
    ))
}

impl<W: Write> Packer<W> {
    fn walk(&mut self, root: &Path, relative: &str) -> Result<(), RunError> {
        let folder = if relative.is_empty() {
            root.to_path_buf()
        } else {
            root.join(relative)
        };
        let mut entries: Vec<_> = std::fs::read_dir(&folder)
            .map_err(|error| RunError::Io(format!("The workspace could not be read: {error}")))?
            .filter_map(Result::ok)
            .collect();
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                note_skipped(
                    &mut self.summary.skipped,
                    entry.file_name().to_string_lossy().into_owned(),
                );
                continue;
            };
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                note_skipped(&mut self.summary.skipped, path);
                continue;
            };
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                if excluded(&path, &name) {
                    continue;
                }
                let mut header = tar::Header::new_gnu();
                header.set_entry_type(tar::EntryType::Directory);
                // Owner only: on a shared cluster the uploaded workspace stays
                // private, and the run is the same user.
                header.set_mode(0o700);
                header.set_size(0);
                header.set_mtime(mtime(&metadata));
                self.builder
                    .append_data(&mut header, format!("{path}/"), std::io::empty())
                    .map_err(|error| RunError::Io(error.to_string()))?;
                self.walk(root, &path)?;
                continue;
            }
            if !metadata.is_file() {
                // Links, reparse points and devices stay behind.
                note_skipped(&mut self.summary.skipped, path);
                continue;
            }
            if metadata.len() > self.limits.max_file {
                note_skipped(&mut self.summary.skipped, path);
                continue;
            }
            if self.summary.files + 1 > self.limits.max_files
                || self.summary.bytes + metadata.len() > self.limits.max_total
            {
                return Err(too_large(&self.limits));
            }
            let Ok(file) = std::fs::File::open(entry.path()) else {
                note_skipped(&mut self.summary.skipped, path);
                continue;
            };
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(tar::EntryType::Regular);
            header.set_mode(file_mode(&metadata));
            header.set_size(metadata.len());
            header.set_mtime(mtime(&metadata));
            // A file that grows while it is read is cut at its listed size.
            self.builder
                .append_data(&mut header, &path, file.take(metadata.len()))
                .map_err(|error| {
                    RunError::Io(format!("The workspace could not be packed: {error}"))
                })?;
            self.summary.files += 1;
            self.summary.bytes += metadata.len();
        }
        Ok(())
    }
}

/// Writes the workspace as `tar.gz`: regular files and folders only, names
/// joined with `/`, sorted, the excluded folders left out.
pub fn pack_workspace<W: Write>(
    root: &Path,
    out: W,
    limits: &PackLimits,
) -> Result<PackSummary, RunError> {
    let mut packer = Packer {
        builder: tar::Builder::new(GzEncoder::new(out, Compression::new(6))),
        limits: *limits,
        summary: PackSummary::default(),
    };
    packer.builder.mode(tar::HeaderMode::Deterministic);
    packer.walk(root, "")?;
    let encoder = packer
        .builder
        .into_inner()
        .map_err(|error| RunError::Io(format!("The workspace could not be packed: {error}")))?;
    encoder
        .finish()
        .and_then(|mut out| out.flush())
        .map_err(|error| RunError::Io(format!("The workspace could not be packed: {error}")))?;
    Ok(packer.summary)
}

/// Refuses a workspace that [`pack_workspace`] would refuse, for an upload
/// that does not go through it (rsync): files over `max_file` are left out
/// by rsync itself, the rest count towards the file and size limits.
pub fn check_upload_limits(root: &Path, limits: &PackLimits) -> Result<(), RunError> {
    fn walk(
        folder: &Path,
        relative: &str,
        limits: &PackLimits,
        files: &mut usize,
        bytes: &mut u64,
    ) -> Result<(), RunError> {
        let Ok(entries) = std::fs::read_dir(folder) else {
            return Ok(());
        };
        for entry in entries.filter_map(Result::ok) {
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.is_dir() {
                if !excluded(&path, &name) {
                    walk(&entry.path(), &path, limits, files, bytes)?;
                }
            } else if metadata.is_file() && metadata.len() <= limits.max_file {
                *files += 1;
                *bytes += metadata.len();
                if *files > limits.max_files || *bytes > limits.max_total {
                    return Err(too_large(limits));
                }
            }
        }
        Ok(())
    }
    walk(root, "", limits, &mut 0, &mut 0)
}

/// The bytes [`pack_workspace`] would send, from file sizes alone.
pub fn workspace_bytes(root: &Path) -> u64 {
    fn walk(folder: &Path, relative: &str, total: &mut u64, seen: &mut usize) {
        let Ok(entries) = std::fs::read_dir(folder) else {
            return;
        };
        for entry in entries.filter_map(Result::ok) {
            *seen += 1;
            if *seen > 100_000 {
                return;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let path = if relative.is_empty() {
                name.clone()
            } else {
                format!("{relative}/{name}")
            };
            let Ok(metadata) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if metadata.is_dir() {
                if !excluded(&path, &name) {
                    walk(&entry.path(), &path, total, seen);
                }
            } else if metadata.is_file() {
                *total += metadata.len();
            }
        }
    }
    let mut total = 0;
    walk(root, "", &mut total, &mut 0);
    total
}

/// Blocking writes into the async pipe, from a blocking thread.
struct PipeWriter {
    stream: tokio::io::DuplexStream,
    runtime: tokio::runtime::Handle,
}

impl Write for PipeWriter {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        use tokio::io::AsyncWriteExt;
        let stream = &mut self.stream;
        self.runtime.block_on(stream.write(buffer))
    }

    fn flush(&mut self) -> std::io::Result<()> {
        use tokio::io::AsyncWriteExt;
        let stream = &mut self.stream;
        self.runtime.block_on(stream.flush())
    }
}

/// Packs on a blocking thread into a 256 KiB pipe, so the upload starts at
/// once and the archive is never held in memory. Dropping the reader stops
/// the packing.
pub fn pack_reader(
    root: PathBuf,
    limits: PackLimits,
) -> (
    tokio::io::DuplexStream,
    tokio::task::JoinHandle<Result<PackSummary, RunError>>,
) {
    let (reader, writer) = tokio::io::duplex(PIPE_BYTES);
    let runtime = tokio::runtime::Handle::current();
    let task = tokio::task::spawn_blocking(move || {
        let mut pipe = PipeWriter {
            stream: writer,
            runtime,
        };
        let summary = pack_workspace(&root, &mut pipe, &limits);
        let _ = pipe.flush();
        drop(pipe);
        summary
    });
    (reader, task)
}

#[derive(Clone, Copy, Debug)]
pub struct UnpackLimits {
    pub max_file: u64,
    pub max_total: u64,
    pub max_files: usize,
}

impl Default for UnpackLimits {
    fn default() -> Self {
        Self {
            max_file: 64 * 1024 * 1024,
            max_total: 512 * 1024 * 1024,
            max_files: 10_000,
        }
    }
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct UnpackSummary {
    pub files: usize,
    pub bytes: u64,
    pub skipped: Vec<String>,
    /// The copy stopped at a size or count cap, and the rest of the archive
    /// was not read (so it was not transferred either).
    pub truncated: bool,
    /// The transfer ran out of time; what arrived is kept.
    pub timed_out: bool,
}

/// A safe relative path, or `None`: UTF-8, `/` separators only, no `..`,
/// root, drive or NUL. A colon is refused only where it means a drive or an
/// alternate data stream (Windows); a file such as
/// `metrics_2026-10-23T12:00:00.csv` is a plain name elsewhere.
fn safe_relative(raw: &[u8]) -> Option<PathBuf> {
    let text = std::str::from_utf8(raw).ok()?;
    if text.is_empty()
        || text.contains(['\\', '\0'])
        || (cfg!(windows) && text.contains(':'))
        || text.starts_with('/')
    {
        return None;
    }
    let mut path = PathBuf::new();
    for component in Path::new(text).components() {
        match component {
            Component::Normal(part) => path.push(part),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    (!path.as_os_str().is_empty()).then_some(path)
}

/// Unpacks a run's outputs into `dest`: regular files and folders only,
/// every path checked and created through a handle on `dest` that cannot
/// follow links out of it, within the size and count caps.
pub fn unpack_outputs<R: Read>(
    archive: R,
    dest: &Path,
    limits: &UnpackLimits,
) -> Result<UnpackSummary, RunError> {
    std::fs::create_dir_all(dest).map_err(|error| {
        RunError::Io(format!("The outputs folder could not be created: {error}"))
    })?;
    let root = cap_std::fs::Dir::open_ambient_dir(dest, cap_std::ambient_authority()).map_err(
        |error| RunError::Io(format!("The outputs folder could not be opened: {error}")),
    )?;
    unpack_into(archive, &root, limits)
}

/// Opens `<workspace>/<relative>` without following a link out of the
/// workspace (the task's own files may hold links), creating it.
pub fn open_inside(workspace: &Path, relative: &str) -> Result<cap_std::fs::Dir, RunError> {
    let root = cap_std::fs::Dir::open_ambient_dir(workspace, cap_std::ambient_authority())
        .map_err(|error| {
            RunError::Io(format!("The task workspace could not be opened: {error}"))
        })?;
    root.create_dir_all(relative).map_err(|error| {
        RunError::Io(format!("The outputs folder could not be created: {error}"))
    })?;
    root.open_dir(relative)
        .map_err(|error| RunError::Io(format!("The outputs folder could not be opened: {error}")))
}

/// [`unpack_outputs`] into an open folder.
pub fn unpack_into<R: Read>(
    archive: R,
    root: &cap_std::fs::Dir,
    limits: &UnpackLimits,
) -> Result<UnpackSummary, RunError> {
    let mut summary = UnpackSummary::default();
    let mut archive = tar::Archive::new(GzDecoder::new(archive));
    let entries = archive.entries().map_err(|error| {
        RunError::Remote(format!("The run's outputs could not be read: {error}"))
    })?;
    for entry in entries {
        let mut entry = entry.map_err(|error| {
            RunError::Remote(format!("The run's outputs could not be read: {error}"))
        })?;
        let raw = entry.path_bytes().into_owned();
        let display = String::from_utf8_lossy(&raw).into_owned();
        let Some(relative) = safe_relative(&raw) else {
            note_skipped(&mut summary.skipped, display);
            continue;
        };
        match entry.header().entry_type() {
            tar::EntryType::Directory => {
                if root.create_dir_all(&relative).is_err() {
                    note_skipped(&mut summary.skipped, display);
                }
                continue;
            }
            tar::EntryType::Regular | tar::EntryType::Continuous => {}
            _ => {
                note_skipped(&mut summary.skipped, display);
                continue;
            }
        }
        let size = entry.header().size().unwrap_or(u64::MAX);
        if size > limits.max_file {
            note_skipped(&mut summary.skipped, display);
            continue;
        }
        // At a cap the rest is not read: the caller drops the stream, which
        // ends the transfer instead of downloading what would be thrown away.
        if summary.files >= limits.max_files || summary.bytes + size > limits.max_total {
            note_skipped(&mut summary.skipped, display);
            summary.truncated = true;
            break;
        }
        if let Some(parent) = relative
            .parent()
            .filter(|parent| !parent.as_os_str().is_empty())
        {
            if root.create_dir_all(parent).is_err() {
                note_skipped(&mut summary.skipped, display);
                continue;
            }
        }
        let mut options = cap_std::fs::OpenOptions::new();
        options
            .write(true)
            .create_new(true)
            .follow(FollowSymlinks::No);
        let Ok(file) = root.open_with(&relative, &options) else {
            note_skipped(&mut summary.skipped, display);
            continue;
        };
        let mut file = file.into_std();
        let copied = std::io::copy(&mut (&mut entry).take(limits.max_file + 1), &mut file);
        match copied {
            Ok(written) if written <= limits.max_file => {
                #[cfg(unix)]
                if entry.header().mode().is_ok_and(|mode| mode & 0o111 != 0) {
                    use std::os::unix::fs::PermissionsExt;
                    // An output the run marked executable runs for its owner;
                    // the rest of its mode stays what this user's umask gave it.
                    if let Ok(metadata) = file.metadata() {
                        let mut permissions = metadata.permissions();
                        permissions.set_mode(permissions.mode() | 0o100);
                        let _ = file.set_permissions(permissions);
                    }
                }
                summary.files += 1;
                summary.bytes += written;
            }
            _ => {
                drop(file);
                let _ = root.remove_file(&relative);
                note_skipped(&mut summary.skipped, display);
            }
        }
    }
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tree() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("src/deep")).unwrap();
        std::fs::write(root.join("main.py"), "print(1)\n").unwrap();
        std::fs::write(root.join("src/deep/data.csv"), "a,b\n1,2\n").unwrap();
        std::fs::create_dir_all(root.join(".git/objects")).unwrap();
        std::fs::write(root.join(".git/HEAD"), "ref").unwrap();
        std::fs::create_dir_all(root.join("runs/r001")).unwrap();
        std::fs::write(root.join("runs/r001/out.txt"), "old").unwrap();
        std::fs::create_dir_all(root.join("src/__pycache__")).unwrap();
        std::fs::write(root.join("src/__pycache__/x.pyc"), "x").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(root.join("main.py"), root.join("link.py")).unwrap();
        dir
    }

    #[test]
    fn pack_round_trips_and_skips_links_and_excluded_folders() {
        let source = tree();
        let mut bytes = Vec::new();
        let summary = pack_workspace(source.path(), &mut bytes, &PackLimits::default()).unwrap();
        assert_eq!(summary.files, 2);
        let dest = tempfile::tempdir().unwrap();
        unpack_outputs(bytes.as_slice(), dest.path(), &UnpackLimits::default()).unwrap();
        assert_eq!(
            std::fs::read_to_string(dest.path().join("main.py")).unwrap(),
            "print(1)\n"
        );
        assert!(dest.path().join("src/deep/data.csv").is_file());
        assert!(!dest.path().join(".git").exists());
        assert!(!dest.path().join("runs").exists());
        assert!(!dest.path().join("src/__pycache__").exists());
        assert!(!dest.path().join("link.py").exists());
        #[cfg(unix)]
        assert!(summary.skipped.contains(&"link.py".to_string()));
    }

    #[cfg(unix)]
    #[test]
    fn pack_keeps_executable_bits() {
        use std::os::unix::fs::PermissionsExt;
        let source = tempfile::tempdir().unwrap();
        let script = source.path().join("run.sh");
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut bytes = Vec::new();
        pack_workspace(source.path(), &mut bytes, &PackLimits::default()).unwrap();
        let dest = tempfile::tempdir().unwrap();
        unpack_outputs(bytes.as_slice(), dest.path(), &UnpackLimits::default()).unwrap();
        let mode = std::fs::metadata(dest.path().join("run.sh"))
            .unwrap()
            .permissions()
            .mode();
        assert_ne!(mode & 0o111, 0);
    }

    #[cfg(windows)]
    #[test]
    fn pack_names_use_forward_slashes() {
        let source = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(source.path().join("a").join("b")).unwrap();
        std::fs::write(source.path().join("a").join("b").join("c.txt"), "x").unwrap();
        let mut bytes = Vec::new();
        pack_workspace(source.path(), &mut bytes, &PackLimits::default()).unwrap();
        let mut archive = tar::Archive::new(GzDecoder::new(bytes.as_slice()));
        let names: Vec<String> = archive
            .entries()
            .unwrap()
            .map(|entry| String::from_utf8_lossy(&entry.unwrap().path_bytes()).into_owned())
            .collect();
        assert!(names.contains(&"a/b/c.txt".to_string()), "{names:?}");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn first_bytes_arrive_before_packing_finishes() {
        use tokio::io::AsyncReadExt;
        let source = tempfile::tempdir().unwrap();
        let noise: Vec<u8> = (0..8 * 1024 * 1024u32)
            .map(|index| (index.wrapping_mul(2_654_435_761) >> 13) as u8)
            .collect();
        std::fs::write(source.path().join("big.bin"), noise).unwrap();
        let (mut reader, task) = pack_reader(source.path().to_path_buf(), PackLimits::default());
        let mut first = vec![0u8; 64 * 1024];
        reader.read_exact(&mut first).await.unwrap();
        assert!(!task.is_finished());
        let mut rest = Vec::new();
        reader.read_to_end(&mut rest).await.unwrap();
        assert_eq!(task.await.unwrap().unwrap().files, 1);
    }

    fn crafted(entries: &[(&str, tar::EntryType, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(GzEncoder::new(Vec::new(), Compression::fast()));
        for (name, kind, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(*kind);
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            if matches!(kind, tar::EntryType::Symlink | tar::EntryType::Link) {
                header.set_link_name("/etc/passwd").unwrap();
            }
            // Write the raw name so unsafe ones reach the reader as they are.
            let bytes = name.as_bytes();
            header.as_old_mut().name[..bytes.len()].copy_from_slice(bytes);
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn unpack_rejects_traversal_absolute_and_links() {
        let outer = tempfile::tempdir().unwrap();
        let dest = outer.path().join("dest");
        let archive = crafted(&[
            ("../evil", tar::EntryType::Regular, b"x"),
            ("/abs", tar::EntryType::Regular, b"x"),
            ("C:\\x", tar::EntryType::Regular, b"x"),
            ("a\\..\\b", tar::EntryType::Regular, b"x"),
            ("link", tar::EntryType::Symlink, b""),
            ("hard", tar::EntryType::Link, b""),
            ("./ok.txt", tar::EntryType::Regular, b"fine"),
        ]);
        let summary = unpack_outputs(archive.as_slice(), &dest, &UnpackLimits::default()).unwrap();
        assert_eq!(summary.files, 1);
        assert_eq!(summary.skipped.len(), 6, "{:?}", summary.skipped);
        assert!(!outer.path().join("evil").exists());
        assert!(!dest.join("link").exists() && !dest.join("hard").exists());
        assert_eq!(
            std::fs::read_to_string(dest.join("ok.txt")).unwrap(),
            "fine"
        );
    }

    #[test]
    fn a_colon_is_a_plain_character_outside_windows() {
        let names = [
            "metrics_2026-10-23T12:00:00.csv",
            "ckpt:best.pt",
            "sub/run:1/log.txt",
        ];
        for name in names {
            assert_eq!(
                safe_relative(name.as_bytes()).is_some(),
                !cfg!(windows),
                "{name}"
            );
        }
        // These stay refused everywhere.
        for name in ["../x", "/x", "a\\b", "C:\\x"] {
            assert!(safe_relative(name.as_bytes()).is_none(), "{name}");
        }
        let dest = tempfile::tempdir().unwrap();
        let archive = crafted(&[("metrics:1.csv", tar::EntryType::Regular, b"x")]);
        let summary =
            unpack_outputs(archive.as_slice(), dest.path(), &UnpackLimits::default()).unwrap();
        assert_eq!(summary.files, usize::from(!cfg!(windows)));
        assert_eq!(dest.path().join("metrics:1.csv").is_file(), !cfg!(windows));
    }

    /// A reader that counts the bytes taken from it.
    struct Counting<R> {
        inner: R,
        read: std::sync::Arc<std::sync::atomic::AtomicUsize>,
    }

    impl<R: Read> Read for Counting<R> {
        fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
            let count = self.inner.read(buffer)?;
            self.read
                .fetch_add(count, std::sync::atomic::Ordering::SeqCst);
            Ok(count)
        }
    }

    #[test]
    fn unpacking_stops_reading_at_the_total_cap() {
        // Twenty 256 KiB files of data that does not compress.
        let noise = |seed: u32| -> Vec<u8> {
            (0..256 * 1024u32)
                .map(|index| ((index ^ seed).wrapping_mul(2_654_435_761) >> 13) as u8)
                .collect()
        };
        let files: Vec<(String, Vec<u8>)> = (0..20)
            .map(|index| (format!("f{index:02}"), noise(index)))
            .collect();
        let entries: Vec<(&str, tar::EntryType, &[u8])> = files
            .iter()
            .map(|(name, data)| (name.as_str(), tar::EntryType::Regular, data.as_slice()))
            .collect();
        let archive = crafted(&entries);
        let read = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let dest = tempfile::tempdir().unwrap();
        let root =
            cap_std::fs::Dir::open_ambient_dir(dest.path(), cap_std::ambient_authority()).unwrap();
        let summary = unpack_into(
            Counting {
                inner: archive.as_slice(),
                read: read.clone(),
            },
            &root,
            &UnpackLimits {
                max_total: 3 * 256 * 1024,
                ..UnpackLimits::default()
            },
        )
        .unwrap();

        assert_eq!(summary.files, 3);
        assert!(summary.truncated);
        assert_eq!(summary.skipped, vec!["f03".to_string()]);
        // Most of the archive was never read, so it was never downloaded.
        let taken = read.load(std::sync::atomic::Ordering::SeqCst);
        assert!(taken < archive.len() / 2, "{taken} of {}", archive.len());
    }

    #[test]
    fn rsync_uploads_keep_to_the_same_limits_as_packed_ones() {
        let source = tree();
        // Two files count (the links and excluded folders do not).
        assert!(check_upload_limits(source.path(), &PackLimits::default()).is_ok());
        let few = PackLimits {
            max_files: 1,
            ..PackLimits::default()
        };
        assert!(matches!(
            check_upload_limits(source.path(), &few),
            Err(RunError::Invalid(_))
        ));
        let small = PackLimits {
            max_total: 8,
            ..PackLimits::default()
        };
        assert!(check_upload_limits(source.path(), &small).is_err());
        // A file over the per-file limit is left out by rsync, not counted.
        let tiny_files = PackLimits {
            max_file: 8,
            max_files: 1,
            ..PackLimits::default()
        };
        assert!(check_upload_limits(source.path(), &tiny_files).is_ok());
    }

    #[test]
    fn unpack_enforces_caps() {
        let dest = tempfile::tempdir().unwrap();
        let archive = crafted(&[
            ("a", tar::EntryType::Regular, b"1"),
            ("b", tar::EntryType::Regular, b"2"),
            ("c", tar::EntryType::Regular, b"3"),
        ]);
        let limits = UnpackLimits {
            max_files: 2,
            ..UnpackLimits::default()
        };
        let summary = unpack_outputs(archive.as_slice(), dest.path(), &limits).unwrap();
        assert_eq!(
            (summary.files, summary.skipped.clone()),
            (2, vec!["c".to_string()])
        );

        let dest = tempfile::tempdir().unwrap();
        let archive = crafted(&[
            ("big", tar::EntryType::Regular, b"0123456789"),
            ("small", tar::EntryType::Regular, b"1"),
        ]);
        let limits = UnpackLimits {
            max_file: 5,
            ..UnpackLimits::default()
        };
        let summary = unpack_outputs(archive.as_slice(), dest.path(), &limits).unwrap();
        assert_eq!(summary.skipped, vec!["big".to_string()]);
        assert!(dest.path().join("small").is_file());

        let dest = tempfile::tempdir().unwrap();
        let archive = crafted(&[
            ("one", tar::EntryType::Regular, b"12345"),
            ("two", tar::EntryType::Regular, b"12345"),
            ("three", tar::EntryType::Regular, b"1"),
        ]);
        let limits = UnpackLimits {
            max_total: 6,
            ..UnpackLimits::default()
        };
        let summary = unpack_outputs(archive.as_slice(), dest.path(), &limits).unwrap();
        assert_eq!(summary.files, 1);
        assert!(!dest.path().join("three").exists());
    }
}
