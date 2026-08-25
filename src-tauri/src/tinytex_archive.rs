use std::collections::HashSet;
use std::path::{Component, Path};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ArchiveFormat {
    Zip,
    TarGz,
    TarXz,
}

#[derive(Clone, Copy)]
pub(crate) struct ArchiveMemberPolicy<'a> {
    pub(crate) members: u64,
    pub(crate) expanded_bytes: u64,
    pub(crate) manifest_sha256: &'a str,
}

struct ArchiveManifest<'a> {
    policy: ArchiveMemberPolicy<'a>,
    hasher: sha2::Sha256,
    members: u64,
    expanded_bytes: u64,
    paths: HashSet<String>,
}

impl<'a> ArchiveManifest<'a> {
    fn new(policy: ArchiveMemberPolicy<'a>) -> Self {
        use sha2::Digest as _;

        Self {
            policy,
            hasher: sha2::Sha256::new(),
            members: 0,
            expanded_bytes: 0,
            paths: HashSet::new(),
        }
    }

    fn record(
        &mut self,
        kind: &str,
        path: &Path,
        size: u64,
        link_target: Option<&Path>,
    ) -> Result<(), String> {
        let path = validated_archive_path(path)?;
        self.validate_member(&path, size, link_target)?;
        self.hash_member(kind, &path, size, link_target)?;
        Ok(())
    }

    fn validate_member(
        &mut self,
        path: &str,
        size: u64,
        link_target: Option<&Path>,
    ) -> Result<(), String> {
        if !self.paths.insert(path.to_owned()) {
            return Err(format!("TinyTeX archive contains duplicate member {path}."));
        }
        if let Some(target) = link_target {
            validate_archive_link_target(Path::new(path), target)?;
        }
        self.members = self
            .members
            .checked_add(1)
            .ok_or_else(|| "TinyTeX archive member count overflowed.".to_string())?;
        self.expanded_bytes = self
            .expanded_bytes
            .checked_add(size)
            .ok_or_else(|| "TinyTeX expanded size overflowed.".to_string())?;
        let within_limits = self.members <= self.policy.members
            && self.expanded_bytes <= self.policy.expanded_bytes;
        within_limits
            .then_some(())
            .ok_or_else(|| "TinyTeX archive exceeds its reviewed extraction limits.".into())
    }

    fn hash_member(
        &mut self,
        kind: &str,
        path: &str,
        size: u64,
        link_target: Option<&Path>,
    ) -> Result<(), String> {
        use sha2::Digest as _;
        self.hasher.update(kind.as_bytes());
        self.hasher.update([0]);
        self.hasher.update(path.as_bytes());
        self.hasher.update([0]);
        self.hasher.update(size.to_le_bytes());
        if let Some(target) = link_target {
            let target = target
                .to_str()
                .ok_or_else(|| "TinyTeX archive has a non-UTF-8 link target.".to_string())?;
            self.hasher.update(target.as_bytes());
        }
        self.hasher.update([0]);
        Ok(())
    }

    fn finish(self) -> Result<(), String> {
        use sha2::Digest as _;

        let digest = format!("{:x}", self.hasher.finalize());
        if self.members != self.policy.members
            || self.expanded_bytes != self.policy.expanded_bytes
            || digest != self.policy.manifest_sha256
        {
            return Err(format!(
                "TinyTeX archive member manifest does not match the reviewed release. Found {} members, {} expanded bytes, and manifest {digest}.",
                self.members, self.expanded_bytes
            ));
        }
        Ok(())
    }
}

fn validate_tar_mode(
    path: &Path,
    mode: u32,
    is_directory: bool,
    is_symlink: bool,
) -> Result<(), String> {
    if is_symlink {
        return Ok(());
    }
    let has_privilege_bits = mode & 0o6000 != 0;
    let has_non_directory_sticky_bit = mode & 0o1000 != 0 && !is_directory;
    if has_privilege_bits || has_non_directory_sticky_bit || mode & 0o002 != 0 {
        return Err(format!(
            "TinyTeX archive member {} has unsafe permissions.",
            path.display()
        ));
    }
    Ok(())
}

fn validate_zip_member_mode(path: &Path, mode: u32, is_directory: bool) -> Result<(), String> {
    let file_type = mode & 0o170000;
    if file_type == 0o120000 {
        return Err("TinyTeX ZIP contains an unsupported symbolic link.".into());
    }
    if !matches!(file_type, 0 | 0o040000 | 0o100000) {
        return Err(format!(
            "TinyTeX ZIP member {} has an unsupported file type.",
            path.display()
        ));
    }
    validate_tar_mode(path, mode, is_directory, false)
}

fn validated_archive_path(path: &Path) -> Result<String, String> {
    let path_text = path
        .to_str()
        .ok_or_else(|| "TinyTeX archive has a non-UTF-8 member path.".to_string())?;
    let mut components = path.components();
    let root = match components.next() {
        Some(Component::Normal(root)) => root,
        _ => return Err("TinyTeX archive contains an unsafe member path.".into()),
    };
    if root != "TinyTeX" && root != ".TinyTeX" {
        return Err(format!(
            "TinyTeX archive contains an unexpected top-level member {path_text}."
        ));
    }
    if components.any(|component| !matches!(component, Component::Normal(_))) {
        return Err(format!(
            "TinyTeX archive contains an unsafe member path {path_text}."
        ));
    }
    Ok(path_text.to_string())
}

fn validate_archive_link_target(path: &Path, target: &Path) -> Result<(), String> {
    if target.is_absolute() {
        return Err(format!(
            "TinyTeX archive member {} has an absolute link target.",
            path.display()
        ));
    }
    let mut depth = path
        .parent()
        .map(|parent| parent.components().count())
        .unwrap_or(0);
    for component in target.components() {
        match component {
            Component::Normal(_) => depth += 1,
            Component::CurDir => {}
            Component::ParentDir if depth > 1 => depth -= 1,
            _ => {
                return Err(format!(
                    "TinyTeX archive member {} has a link target outside its reviewed root.",
                    path.display()
                ));
            }
        }
    }
    Ok(())
}

pub(crate) fn inspect_tar<R: std::io::Read>(
    reader: R,
    policy: ArchiveMemberPolicy<'_>,
) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    let mut manifest = ArchiveManifest::new(policy);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let (kind, link_target) = tar_member_kind(&mut entry)?;
        let path = entry.path().map_err(|e| e.to_string())?.into_owned();
        validate_tar_mode(
            &path,
            entry.header().mode().map_err(|e| e.to_string())?,
            entry.header().entry_type().is_dir(),
            entry.header().entry_type().is_symlink(),
        )?;
        manifest.record(kind, &path, entry.size(), link_target.as_deref())?;
    }
    manifest.finish()
}

fn tar_member_kind<R: std::io::Read>(
    entry: &mut tar::Entry<'_, R>,
) -> Result<(&'static str, Option<std::path::PathBuf>), String> {
    let entry_type = entry.header().entry_type();
    if entry_type.is_file() {
        return Ok(("file", None));
    }
    if entry_type.is_dir() {
        return Ok(("directory", None));
    }
    if !entry_type.is_symlink() {
        return Err("TinyTeX archive contains an unsupported member type.".into());
    }
    let target = entry
        .link_name()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "TinyTeX archive contains a symlink without a target.".to_string())?;
    Ok(("symlink", Some(target.into_owned())))
}

fn extract_tar<R: std::io::Read>(reader: R, destination: &Path) -> Result<(), String> {
    let mut archive = tar::Archive::new(reader);
    archive.set_preserve_permissions(false);
    archive.set_overwrite(true);
    for entry in archive.entries().map_err(|e| e.to_string())? {
        let mut entry = entry.map_err(|e| e.to_string())?;
        let path = validate_tar_entry(&mut entry)?;
        if !entry.unpack_in(destination).map_err(|e| e.to_string())? {
            return Err(format!(
                "TinyTeX archive member {} could not be confined to staging.",
                path.display()
            ));
        }
    }
    Ok(())
}

fn validate_tar_entry<R: std::io::Read>(
    entry: &mut tar::Entry<'_, R>,
) -> Result<std::path::PathBuf, String> {
    let path = entry.path().map_err(|e| e.to_string())?.into_owned();
    validated_archive_path(&path)?;
    validate_tar_mode(
        &path,
        entry.header().mode().map_err(|e| e.to_string())?,
        entry.header().entry_type().is_dir(),
        entry.header().entry_type().is_symlink(),
    )?;
    if entry.header().entry_type().is_symlink() {
        let target = entry
            .link_name()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| "TinyTeX archive contains a symlink without a target.".to_string())?;
        validate_archive_link_target(&path, &target)?;
    }
    Ok(path)
}

pub(crate) fn inspect_archive(
    archive: &Path,
    format: ArchiveFormat,
    policy: ArchiveMemberPolicy<'_>,
) -> Result<(), String> {
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    match format {
        ArchiveFormat::TarGz => inspect_tar(flate2::read::GzDecoder::new(file), policy),
        ArchiveFormat::TarXz => inspect_xz(file, policy),
        ArchiveFormat::Zip => inspect_zip(file, policy),
    }
}

#[cfg(target_os = "linux")]
fn inspect_xz(file: std::fs::File, policy: ArchiveMemberPolicy<'_>) -> Result<(), String> {
    const XZ_MEMORY_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
    let stream = liblzma::stream::Stream::new_stream_decoder(XZ_MEMORY_LIMIT_BYTES, 0)
        .map_err(|e| format!("failed to initialize XZ decoder: {e}"))?;
    inspect_tar(liblzma::read::XzDecoder::new_stream(file, stream), policy)
}

#[cfg(not(target_os = "linux"))]
fn inspect_xz(_file: std::fs::File, _policy: ArchiveMemberPolicy<'_>) -> Result<(), String> {
    Err("XZ TinyTeX archives are supported only on Linux.".into())
}

fn inspect_zip(file: std::fs::File, policy: ArchiveMemberPolicy<'_>) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut manifest = ArchiveManifest::new(policy);
    for index in 0..zip.len() {
        let entry = zip.by_index(index).map_err(|e| e.to_string())?;
        let path = entry
            .enclosed_name()
            .ok_or_else(|| "TinyTeX archive contains an unsafe member path.".to_string())?;
        let kind = if entry.is_dir() { "directory" } else { "file" };
        if let Some(mode) = entry.unix_mode() {
            validate_zip_member_mode(&path, mode, entry.is_dir())?;
        }
        manifest.record(kind, &path, entry.size(), None)?;
    }
    manifest.finish()
}

pub(crate) fn extract_all(
    archive: &Path,
    format: ArchiveFormat,
    policy: ArchiveMemberPolicy<'_>,
    destination: &Path,
) -> Result<(), String> {
    inspect_archive(archive, format, policy)?;
    std::fs::create_dir_all(destination).map_err(|e| e.to_string())?;
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    match format {
        ArchiveFormat::TarGz => extract_tar(flate2::read::GzDecoder::new(file), destination),
        ArchiveFormat::TarXz => extract_xz(file, destination),
        ArchiveFormat::Zip => extract_zip(file, destination),
    }
}

#[cfg(target_os = "linux")]
fn extract_xz(file: std::fs::File, destination: &Path) -> Result<(), String> {
    const XZ_MEMORY_LIMIT_BYTES: u64 = 64 * 1024 * 1024;
    let stream = liblzma::stream::Stream::new_stream_decoder(XZ_MEMORY_LIMIT_BYTES, 0)
        .map_err(|e| format!("failed to initialize XZ decoder: {e}"))?;
    extract_tar(
        liblzma::read::XzDecoder::new_stream(file, stream),
        destination,
    )
}

#[cfg(not(target_os = "linux"))]
fn extract_xz(_file: std::fs::File, _destination: &Path) -> Result<(), String> {
    Err("XZ TinyTeX archives are supported only on Linux.".into())
}

fn extract_zip(file: std::fs::File, destination: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
        extract_zip_entry(&mut entry, destination)?;
    }
    Ok(())
}

fn extract_zip_entry<R: std::io::Read>(
    entry: &mut zip::read::ZipFile<'_, R>,
    destination: &Path,
) -> Result<(), String> {
    let relative = entry
        .enclosed_name()
        .ok_or_else(|| "TinyTeX archive contains an unsafe member path.".to_string())?
        .to_path_buf();
    let output = destination.join(relative);
    if entry.is_dir() {
        return std::fs::create_dir_all(&output).map_err(|e| e.to_string());
    }
    if let Some(parent) = output.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut target = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .map_err(|e| e.to_string())?;
    std::io::copy(entry, &mut target).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;

    fn manifest_digest(entries: &[(&str, &str, u64, Option<&str>)]) -> String {
        use sha2::Digest as _;

        let mut hasher = sha2::Sha256::new();
        for (kind, path, size, link_target) in entries {
            hasher.update(kind.as_bytes());
            hasher.update([0]);
            hasher.update(path.as_bytes());
            hasher.update([0]);
            hasher.update(size.to_le_bytes());
            if let Some(target) = link_target {
                hasher.update(target.as_bytes());
            }
            hasher.update([0]);
        }
        format!("{:x}", hasher.finalize())
    }

    fn policy() -> ArchiveMemberPolicy<'static> {
        ArchiveMemberPolicy {
            members: 1,
            expanded_bytes: 1,
            manifest_sha256: "unused",
        }
    }

    #[test]
    fn member_paths_stay_beneath_the_reviewed_root() {
        assert!(validated_archive_path(Path::new("TinyTeX/bin/tool")).is_ok());
        assert!(validated_archive_path(Path::new("TinyTeX/../escape")).is_err());
        assert!(validated_archive_path(Path::new("Other/tool")).is_err());
        assert!(validated_archive_path(Path::new("/TinyTeX/tool")).is_err());
    }

    #[test]
    fn link_targets_cannot_escape_the_reviewed_root() {
        assert!(validate_archive_link_target(
            Path::new("TinyTeX/bin/tool"),
            Path::new("../lib/tool")
        )
        .is_ok());
        assert!(validate_archive_link_target(
            Path::new("TinyTeX/bin/tool"),
            Path::new("../../outside")
        )
        .is_err());
        assert!(
            validate_archive_link_target(Path::new("TinyTeX/bin/tool"), Path::new("/outside"))
                .is_err()
        );
    }

    #[test]
    fn duplicate_members_are_rejected() {
        let mut manifest = ArchiveManifest::new(policy());
        manifest
            .record("file", Path::new("TinyTeX/file"), 1, None)
            .unwrap();
        assert!(manifest
            .record("file", Path::new("TinyTeX/file"), 1, None)
            .is_err());
    }

    #[test]
    fn unsafe_archive_permissions_are_rejected() {
        let path = Path::new("TinyTeX/member");
        assert!(validate_tar_mode(path, 0o755, false, false).is_ok());
        assert!(validate_tar_mode(path, 0o1755, false, false).is_err());
        assert!(validate_tar_mode(path, 0o1755, true, false).is_ok());
        assert!(validate_tar_mode(path, 0o2755, true, false).is_err());
        assert!(validate_tar_mode(path, 0o4755, true, false).is_err());
        assert!(validate_tar_mode(path, 0o1757, true, false).is_err());
        assert!(validate_tar_mode(path, 0o777, false, false).is_err());
        assert!(validate_tar_mode(path, 0o777, false, true).is_ok());
    }

    #[test]
    fn sticky_directory_permissions_are_accepted() {
        let path = "TinyTeX/texmf-var/fonts/pk/ljfour/";
        let mut writer = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o1755);
        header.set_entry_type(tar::EntryType::Directory);
        header.set_cksum();
        writer.append_data(&mut header, path, &[][..]).unwrap();
        let tar = writer.into_inner().unwrap();
        let digest = manifest_digest(&[("directory", path, 0, None)]);
        let policy = ArchiveMemberPolicy {
            members: 1,
            expanded_bytes: 0,
            manifest_sha256: &digest,
        };

        inspect_tar(std::io::Cursor::new(&tar), policy).unwrap();

        let destination = tempfile::tempdir().unwrap();
        extract_tar(std::io::Cursor::new(&tar), destination.path()).unwrap();
        let extracted = destination.path().join(path);
        assert!(extracted.is_dir());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(
                std::fs::metadata(extracted).unwrap().permissions().mode() & 0o7000,
                0
            );
        }
    }

    #[test]
    fn world_writable_symlink_modes_are_accepted() {
        let link = "TinyTeX/bin/x86_64-linux/texhash";
        let mut writer = tar::Builder::new(Vec::new());
        let mut header = tar::Header::new_gnu();
        header.set_size(0);
        header.set_mode(0o777);
        header.set_entry_type(tar::EntryType::Symlink);
        writer.append_link(&mut header, link, "mktexlsr").unwrap();
        let tar = writer.into_inner().unwrap();
        let digest = manifest_digest(&[("symlink", link, 0, Some("mktexlsr"))]);
        let policy = ArchiveMemberPolicy {
            members: 1,
            expanded_bytes: 0,
            manifest_sha256: &digest,
        };

        inspect_tar(std::io::Cursor::new(&tar), policy).unwrap();

        let destination = tempfile::tempdir().unwrap();
        extract_tar(std::io::Cursor::new(&tar), destination.path()).unwrap();
        assert!(destination
            .path()
            .join(link)
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
    }

    #[test]
    fn zip_members_with_unsafe_unix_permissions_are_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let archive = directory.path().join("unsafe.zip");
        let file = std::fs::File::create(&archive).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default().unix_permissions(0o4777);
        writer.start_file("TinyTeX/tool", options).unwrap();
        writer.write_all(b"x").unwrap();
        writer.finish().unwrap();

        let error = inspect_zip(std::fs::File::open(archive).unwrap(), policy()).unwrap_err();
        assert!(error.contains("unsafe permissions"), "{error}");
    }
}
