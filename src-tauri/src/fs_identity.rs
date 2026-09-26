use serde::{Deserialize, Serialize};
use std::io;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) struct FsIdentity {
    pub(crate) volume: Option<String>,
    pub(crate) file: String,
    pub(crate) birth_ns: Option<i64>,
    #[serde(default)]
    pub(crate) weak: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum IdentityMatch {
    FullMatch,
    SameObjectOtherVolume,
    Different,
    Unknown,
}

pub(crate) fn compare(recorded: &FsIdentity, observed: &FsIdentity) -> IdentityMatch {
    if recorded.weak || observed.weak {
        return IdentityMatch::Unknown;
    }
    if recorded.file != observed.file {
        return IdentityMatch::Different;
    }
    match (recorded.birth_ns, observed.birth_ns) {
        (Some(left), Some(right)) if left != right => return IdentityMatch::Different,
        (Some(_), Some(_)) => {}
        _ => return IdentityMatch::Unknown,
    }
    match (&recorded.volume, &observed.volume) {
        (Some(left), Some(right)) if left == right => IdentityMatch::FullMatch,
        _ => IdentityMatch::SameObjectOtherVolume,
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum VolumeKind {
    Local,
    Network,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum CaseSensitivity {
    Sensitive,
    Insensitive,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct DirectoryIdentity {
    pub(crate) identity: FsIdentity,
    pub(crate) volume_kind: VolumeKind,
    pub(crate) file_system: String,
    pub(crate) case: CaseSensitivity,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct VolumeFacts {
    id: Option<String>,
    kind: VolumeKind,
    file_system: String,
    weak: bool,
    case: CaseSensitivity,
}

pub(crate) fn identify_directory(path: &Path) -> io::Result<DirectoryIdentity> {
    let path: PathBuf = path.components().collect();
    let directory = open_directory(&path)?;
    let metadata = directory.metadata()?;
    if !metadata.is_dir() {
        return Err(io::ErrorKind::NotADirectory.into());
    }
    let (volume, file) = volume_and_file(&path, &directory, &metadata)?;
    Ok(DirectoryIdentity {
        identity: FsIdentity {
            volume: volume.id,
            file,
            birth_ns: birth_ns(&metadata),
            weak: volume.weak,
        },
        volume_kind: volume.kind,
        file_system: volume.file_system,
        case: volume.case,
    })
}

#[cfg(unix)]
pub(crate) fn quick_matches(recorded: &FsIdentity, metadata: &std::fs::Metadata) -> Option<bool> {
    use std::os::unix::fs::MetadataExt as _;
    if recorded.weak {
        return None;
    }
    if format!("{:x}", metadata.ino()) != recorded.file {
        return Some(false);
    }
    match (recorded.birth_ns, birth_ns(metadata)) {
        (Some(left), Some(right)) if left != right => Some(false),
        _ => Some(true),
    }
}

#[cfg(not(unix))]
pub(crate) fn quick_matches(_recorded: &FsIdentity, _metadata: &std::fs::Metadata) -> Option<bool> {
    None
}

fn birth_ns(metadata: &std::fs::Metadata) -> Option<i64> {
    let created = metadata.created().ok()?;
    let since_epoch = created.duration_since(std::time::UNIX_EPOCH).ok()?;
    i64::try_from(since_epoch.as_nanos())
        .ok()
        .filter(|nanos| *nanos > 0)
}

#[cfg(test)]
pub(crate) fn same_path(left: &Path, right: &Path, case: CaseSensitivity) -> bool {
    let mut left = left.components();
    let mut right = right.components();
    loop {
        match (left.next(), right.next()) {
            (None, None) => return true,
            (Some(expected), Some(actual)) if same_component(expected, actual, case) => {}
            _ => return false,
        }
    }
}

#[cfg(test)]
pub(crate) fn path_is_within(path: &Path, ancestor: &Path, case: CaseSensitivity) -> bool {
    let mut path = path.components();
    ancestor.components().all(|expected| {
        path.next()
            .is_some_and(|actual| same_component(expected, actual, case))
    })
}

#[cfg(test)]
fn same_component(
    left: std::path::Component<'_>,
    right: std::path::Component<'_>,
    case: CaseSensitivity,
) -> bool {
    let (left, right) = (left.as_os_str(), right.as_os_str());
    if left == right {
        return true;
    }
    if case != CaseSensitivity::Insensitive {
        return false;
    }
    match (left.to_str(), right.to_str()) {
        (Some(left), Some(right)) => left
            .chars()
            .flat_map(char::to_lowercase)
            .eq(right.chars().flat_map(char::to_lowercase)),
        _ => false,
    }
}

#[cfg(unix)]
fn open_directory(path: &Path) -> io::Result<std::fs::File> {
    use std::os::unix::fs::OpenOptionsExt as _;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(path)
}

#[cfg(target_os = "macos")]
fn volume_and_file(
    _path: &Path,
    directory: &std::fs::File,
    metadata: &std::fs::Metadata,
) -> io::Result<(VolumeFacts, String)> {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::fs::MetadataExt as _;
    let descriptor = directory.as_raw_fd();
    let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstatfs(descriptor, &mut stats) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let attributes = apple_descriptor_attributes(descriptor)
        .or_else(|| apple_mount_attributes(&stats.f_mntonname));
    let case = match unsafe { libc::fpathconf(descriptor, libc::_PC_CASE_SENSITIVE) } {
        1 => CaseSensitivity::Sensitive,
        0 => CaseSensitivity::Insensitive,
        _ => CaseSensitivity::Unknown,
    };
    let facts = apple_volume_facts(
        (stats.f_flags & libc::MNT_LOCAL as u32) != 0,
        attributes,
        String::from_utf8_lossy(&c_chars(&stats.f_fstypename)).into_owned(),
        case,
    );
    Ok((facts, format!("{:x}", metadata.ino())))
}

#[cfg(any(target_os = "macos", test))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AppleVolumeAttributes {
    uuid: Option<[u8; 16]>,
    persistent_ids: bool,
}

#[cfg(any(target_os = "macos", test))]
fn apple_volume_facts(
    local: bool,
    attributes: Option<AppleVolumeAttributes>,
    file_system: String,
    case: CaseSensitivity,
) -> VolumeFacts {
    let persistent_ids = attributes.is_some_and(|value| value.persistent_ids);
    VolumeFacts {
        id: attributes
            .and_then(|value| value.uuid)
            .map(|uuid| format!("uuid:{}", uuid_text(&uuid))),
        kind: if local {
            VolumeKind::Local
        } else {
            VolumeKind::Network
        },
        file_system,
        weak: !local || !persistent_ids,
        case,
    }
}

#[cfg(any(target_os = "macos", test))]
fn uuid_text(bytes: &[u8; 16]) -> String {
    use std::fmt::Write as _;
    let mut text = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) {
            text.push('-');
        }
        let _ = write!(text, "{byte:02X}");
    }
    text
}

#[cfg(target_os = "macos")]
#[repr(C)]
struct AppleVolumeBuffer {
    length: u32,
    returned: libc::attribute_set_t,
    capabilities: libc::vol_capabilities_attr_t,
    uuid: libc::uuid_t,
}

#[cfg(target_os = "macos")]
fn apple_attribute_request() -> libc::attrlist {
    libc::attrlist {
        bitmapcount: libc::ATTR_BIT_MAP_COUNT,
        reserved: 0,
        commonattr: libc::ATTR_CMN_RETURNED_ATTRS,
        volattr: libc::ATTR_VOL_INFO | libc::ATTR_VOL_CAPABILITIES | libc::ATTR_VOL_UUID,
        dirattr: 0,
        fileattr: 0,
        forkattr: 0,
    }
}

#[cfg(target_os = "macos")]
fn apple_descriptor_attributes(descriptor: libc::c_int) -> Option<AppleVolumeAttributes> {
    let mut request = apple_attribute_request();
    let mut buffer: AppleVolumeBuffer = unsafe { std::mem::zeroed() };
    let status = unsafe {
        libc::fgetattrlist(
            descriptor,
            (&mut request as *mut libc::attrlist).cast(),
            (&mut buffer as *mut AppleVolumeBuffer).cast(),
            std::mem::size_of::<AppleVolumeBuffer>(),
            libc::FSOPT_PACK_INVAL_ATTRS,
        )
    };
    if status != 0 {
        return None;
    }
    apple_parse_attributes(&buffer)
}

#[cfg(target_os = "macos")]
fn apple_mount_attributes(mount: &[libc::c_char]) -> Option<AppleVolumeAttributes> {
    let mount = std::ffi::CString::new(c_chars(mount)).ok()?;
    let mut request = apple_attribute_request();
    let mut buffer: AppleVolumeBuffer = unsafe { std::mem::zeroed() };
    let status = unsafe {
        libc::getattrlist(
            mount.as_ptr(),
            (&mut request as *mut libc::attrlist).cast(),
            (&mut buffer as *mut AppleVolumeBuffer).cast(),
            std::mem::size_of::<AppleVolumeBuffer>(),
            libc::FSOPT_PACK_INVAL_ATTRS,
        )
    };
    if status != 0 {
        return None;
    }
    apple_parse_attributes(&buffer)
}

#[cfg(target_os = "macos")]
fn apple_parse_attributes(buffer: &AppleVolumeBuffer) -> Option<AppleVolumeAttributes> {
    if (buffer.length as usize) < std::mem::size_of::<AppleVolumeBuffer>() {
        return None;
    }
    let format = libc::VOL_CAPABILITIES_FORMAT;
    let persistent = libc::VOL_CAP_FMT_PERSISTENTOBJECTIDS;
    let capabilities_returned = (buffer.returned.volattr & libc::ATTR_VOL_CAPABILITIES) != 0;
    let uuid_returned = (buffer.returned.volattr & libc::ATTR_VOL_UUID) != 0;
    Some(AppleVolumeAttributes {
        uuid: (uuid_returned && buffer.uuid != [0; 16]).then_some(buffer.uuid),
        persistent_ids: capabilities_returned
            && (buffer.capabilities.valid[format] & persistent) != 0
            && (buffer.capabilities.capabilities[format] & persistent) != 0,
    })
}

#[cfg(target_os = "macos")]
fn c_chars(value: &[libc::c_char]) -> Vec<u8> {
    value
        .iter()
        .take_while(|unit| **unit != 0)
        .map(|unit| *unit as u8)
        .collect()
}

#[cfg(target_os = "linux")]
fn volume_and_file(
    _path: &Path,
    directory: &std::fs::File,
    metadata: &std::fs::Metadata,
) -> io::Result<(VolumeFacts, String)> {
    use std::os::fd::AsRawFd as _;
    use std::os::unix::fs::MetadataExt as _;
    let mut stats: libc::statfs = unsafe { std::mem::zeroed() };
    if unsafe { libc::fstatfs(directory.as_raw_fd(), &mut stats) } != 0 {
        return Err(io::Error::last_os_error());
    }
    let fsid = unsafe { std::mem::transmute::<libc::fsid_t, [libc::c_int; 2]>(stats.f_fsid) };
    Ok((
        linux_volume_facts(stats.f_type as u32, fsid),
        format!("{:x}", metadata.ino()),
    ))
}

#[cfg(any(target_os = "linux", test))]
fn linux_volume_facts(magic: u32, fsid: [i32; 2]) -> VolumeFacts {
    let (file_system, kind, weak, case) = match magic {
        0x4d44 => (
            "vfat",
            VolumeKind::Local,
            true,
            CaseSensitivity::Insensitive,
        ),
        0x2011_bab0 => (
            "exfat",
            VolumeKind::Local,
            true,
            CaseSensitivity::Insensitive,
        ),
        0x6969 => ("nfs", VolumeKind::Network, true, CaseSensitivity::Unknown),
        0x517b | 0xff53_4d42 | 0xfe53_4d42 => {
            ("smb", VolumeKind::Network, true, CaseSensitivity::Unknown)
        }
        0x00c3_6400 => ("ceph", VolumeKind::Network, true, CaseSensitivity::Unknown),
        0x5346_414f => ("afs", VolumeKind::Network, true, CaseSensitivity::Unknown),
        0x0102_1997 => ("9p", VolumeKind::Network, true, CaseSensitivity::Unknown),
        0x786f_4256 => (
            "vboxsf",
            VolumeKind::Network,
            true,
            CaseSensitivity::Unknown,
        ),
        0x6573_5546 => ("fuse", VolumeKind::Network, true, CaseSensitivity::Unknown),
        0xef53 => ("ext", VolumeKind::Local, false, CaseSensitivity::Sensitive),
        0x9123_683e => (
            "btrfs",
            VolumeKind::Local,
            false,
            CaseSensitivity::Sensitive,
        ),
        0x5846_5342 => ("xfs", VolumeKind::Local, false, CaseSensitivity::Sensitive),
        0x0102_1994 => (
            "tmpfs",
            VolumeKind::Local,
            false,
            CaseSensitivity::Sensitive,
        ),
        _ => ("", VolumeKind::Local, false, CaseSensitivity::Sensitive),
    };
    let [high, low] = fsid.map(|part| part as u32);
    VolumeFacts {
        id: (fsid != [0, 0]).then(|| format!("fsid:{high:08x}{low:08x}")),
        kind,
        file_system: if file_system.is_empty() {
            format!("{magic:#010x}")
        } else {
            file_system.to_string()
        },
        weak,
        case,
    }
}

#[cfg(windows)]
fn open_directory(path: &Path) -> io::Result<std::fs::File> {
    use std::os::windows::fs::OpenOptionsExt as _;
    use windows_sys::Win32::Storage::FileSystem::{
        FILE_FLAG_BACKUP_SEMANTICS, FILE_FLAG_OPEN_REPARSE_POINT,
    };
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT)
        .open(path)
}

#[cfg(windows)]
fn volume_and_file(
    path: &Path,
    directory: &std::fs::File,
    _metadata: &std::fs::Metadata,
) -> io::Result<(VolumeFacts, String)> {
    use std::os::windows::io::AsRawHandle as _;
    let handle = directory.as_raw_handle();
    let (serial, file) = windows_file_id(handle)?;
    let facts = windows_volume_facts(
        serial,
        windows_file_system(handle),
        windows_is_remote(path),
        windows_case(handle),
    );
    Ok((facts, file))
}

#[cfg(windows)]
fn windows_file_id(handle: std::os::windows::io::RawHandle) -> io::Result<(u64, String)> {
    use windows_sys::Win32::Storage::FileSystem::{
        FileIdInfo, GetFileInformationByHandle, GetFileInformationByHandleEx,
        BY_HANDLE_FILE_INFORMATION, FILE_ID_INFO,
    };
    let mut extended = FILE_ID_INFO::default();
    let read = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileIdInfo,
            (&mut extended as *mut FILE_ID_INFO).cast(),
            std::mem::size_of::<FILE_ID_INFO>() as u32,
        )
    };
    if read != 0 {
        let file = u128::from_le_bytes(extended.FileId.Identifier);
        return Ok((extended.VolumeSerialNumber, format!("{file:x}")));
    }
    let mut basic = BY_HANDLE_FILE_INFORMATION::default();
    if unsafe { GetFileInformationByHandle(handle, &mut basic) } == 0 {
        return Err(io::Error::last_os_error());
    }
    let index = (u64::from(basic.nFileIndexHigh) << 32) | u64::from(basic.nFileIndexLow);
    Ok((u64::from(basic.dwVolumeSerialNumber), format!("{index:x}")))
}

#[cfg(windows)]
fn windows_file_system(handle: std::os::windows::io::RawHandle) -> Option<String> {
    use windows_sys::Win32::Storage::FileSystem::GetVolumeInformationByHandleW;
    let mut name = [0u16; 261];
    let read = unsafe {
        GetVolumeInformationByHandleW(
            handle,
            std::ptr::null_mut(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            name.as_mut_ptr(),
            name.len() as u32,
        )
    };
    if read == 0 {
        return None;
    }
    let length = name
        .iter()
        .position(|unit| *unit == 0)
        .unwrap_or(name.len());
    Some(String::from_utf16_lossy(&name[..length]))
}

#[cfg(windows)]
fn windows_is_remote(path: &Path) -> bool {
    use std::os::windows::ffi::OsStrExt as _;
    use std::path::{Component, Prefix};
    use windows_sys::Win32::Storage::FileSystem::{GetDriveTypeW, GetVolumePathNameW};
    const DRIVE_REMOTE: u32 = 4;
    if let Some(Component::Prefix(prefix)) = path.components().next() {
        if matches!(prefix.kind(), Prefix::UNC(..) | Prefix::VerbatimUNC(..)) {
            return true;
        }
    }
    let wide: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut root = vec![0u16; wide.len() + 1];
    let found = unsafe {
        GetVolumePathNameW(
            wide.as_ptr(),
            root.as_mut_ptr(),
            u32::try_from(root.len()).unwrap_or(u32::MAX),
        )
    };
    found != 0 && unsafe { GetDriveTypeW(root.as_ptr()) } == DRIVE_REMOTE
}

#[cfg(windows)]
fn windows_case(handle: std::os::windows::io::RawHandle) -> CaseSensitivity {
    use windows_sys::Win32::Storage::FileSystem::{
        FileCaseSensitiveInfo, GetFileInformationByHandleEx, FILE_CASE_SENSITIVE_INFO,
    };
    const FILE_CS_FLAG_CASE_SENSITIVE_DIR: u32 = 1;
    let mut info = FILE_CASE_SENSITIVE_INFO::default();
    let read = unsafe {
        GetFileInformationByHandleEx(
            handle,
            FileCaseSensitiveInfo,
            (&mut info as *mut FILE_CASE_SENSITIVE_INFO).cast(),
            std::mem::size_of::<FILE_CASE_SENSITIVE_INFO>() as u32,
        )
    };
    if read != 0 && (info.Flags & FILE_CS_FLAG_CASE_SENSITIVE_DIR) != 0 {
        CaseSensitivity::Sensitive
    } else {
        CaseSensitivity::Insensitive
    }
}

#[cfg(any(windows, test))]
fn windows_volume_facts(
    serial: u64,
    file_system: Option<String>,
    remote: bool,
    case: CaseSensitivity,
) -> VolumeFacts {
    let synthesized_ids = file_system.as_deref().is_none_or(|name| {
        matches!(
            name.to_ascii_uppercase().as_str(),
            "FAT" | "FAT12" | "FAT16" | "FAT32" | "EXFAT"
        )
    });
    VolumeFacts {
        id: (serial != 0).then(|| format!("serial:{serial:016x}")),
        kind: if remote {
            VolumeKind::Network
        } else {
            VolumeKind::Local
        },
        file_system: file_system.unwrap_or_default(),
        weak: remote || synthesized_ids,
        case,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(volume: Option<&str>, file: &str, birth_ns: Option<i64>) -> FsIdentity {
        FsIdentity {
            volume: volume.map(str::to_string),
            file: file.to_string(),
            birth_ns,
            weak: false,
        }
    }

    #[test]
    fn identical_identities_fully_match() {
        let recorded = identity(Some("uuid:A"), "2a", Some(7));
        assert_eq!(
            compare(&recorded, &recorded.clone()),
            IdentityMatch::FullMatch
        );
    }

    #[test]
    fn the_same_object_on_a_remounted_volume_is_reported_separately() {
        let recorded = identity(Some("uuid:A"), "2a", Some(7));
        assert_eq!(
            compare(&recorded, &identity(Some("uuid:B"), "2a", Some(7))),
            IdentityMatch::SameObjectOtherVolume
        );
        assert_eq!(
            compare(&recorded, &identity(None, "2a", Some(7))),
            IdentityMatch::SameObjectOtherVolume
        );
    }

    #[test]
    fn a_different_file_id_or_birth_time_is_a_different_folder() {
        let recorded = identity(Some("uuid:A"), "2a", Some(7));
        assert_eq!(
            compare(&recorded, &identity(Some("uuid:A"), "2b", Some(7))),
            IdentityMatch::Different
        );
        assert_eq!(
            compare(&recorded, &identity(Some("uuid:A"), "2a", Some(8))),
            IdentityMatch::Different
        );
        assert_eq!(
            compare(&recorded, &identity(Some("uuid:B"), "2b", None)),
            IdentityMatch::Different
        );
    }

    #[test]
    fn a_file_id_without_birth_times_on_both_sides_proves_nothing() {
        let recorded = identity(Some("uuid:A"), "2a", Some(7));
        assert_eq!(
            compare(&recorded, &identity(Some("uuid:A"), "2a", None)),
            IdentityMatch::Unknown
        );
        assert_eq!(
            compare(
                &identity(Some("uuid:A"), "2a", None),
                &identity(Some("uuid:A"), "2a", None)
            ),
            IdentityMatch::Unknown
        );
    }

    #[test]
    fn a_weak_volume_never_matches_by_identity() {
        let mut weak = identity(Some("uuid:A"), "2a", Some(7));
        weak.weak = true;
        let strong = identity(Some("uuid:A"), "2a", Some(7));
        assert_eq!(compare(&weak, &strong), IdentityMatch::Unknown);
        assert_eq!(compare(&strong, &weak), IdentityMatch::Unknown);
        let mut other = identity(Some("uuid:A"), "ff", Some(9));
        other.weak = true;
        assert_eq!(compare(&weak, &other), IdentityMatch::Unknown);
    }

    #[test]
    fn identity_json_shape_is_stable() {
        let recorded = identity(
            Some("uuid:6EC49808-1BB0-4AC3-B5D2-66E3BD40BA38"),
            "1889f2b2",
            Some(1_790_414_591_143_117_687),
        );
        let json = serde_json::to_value(&recorded).unwrap();
        assert_eq!(
            json,
            serde_json::json!({
                "volume": "uuid:6EC49808-1BB0-4AC3-B5D2-66E3BD40BA38",
                "file": "1889f2b2",
                "birth_ns": 1_790_414_591_143_117_687_i64,
                "weak": false
            })
        );
        let legacy: FsIdentity =
            serde_json::from_str(r#"{"volume":null,"file":"2a","birth_ns":null}"#).unwrap();
        assert_eq!(legacy, identity(None, "2a", None));
    }

    fn expected_for_same_object(recorded: &FsIdentity) -> IdentityMatch {
        if recorded.weak || recorded.birth_ns.is_none() {
            IdentityMatch::Unknown
        } else {
            IdentityMatch::FullMatch
        }
    }

    #[test]
    fn a_renamed_or_moved_directory_keeps_its_identity() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("thesis");
        std::fs::create_dir(&original).unwrap();
        std::fs::write(original.join("main.tex"), "\\documentclass{article}").unwrap();
        let recorded = identify_directory(&original).unwrap();

        let renamed = directory.path().join("thesis-final");
        std::fs::rename(&original, &renamed).unwrap();
        let after_rename = identify_directory(&renamed).unwrap();
        assert_eq!(
            compare(&recorded.identity, &after_rename.identity),
            expected_for_same_object(&recorded.identity)
        );

        let parent = directory.path().join("archive");
        std::fs::create_dir(&parent).unwrap();
        let moved = parent.join("thesis");
        std::fs::rename(&renamed, &moved).unwrap();
        let after_move = identify_directory(&moved).unwrap();
        assert_eq!(recorded, after_move);
        assert_eq!(
            compare(&recorded.identity, &after_move.identity),
            expected_for_same_object(&recorded.identity)
        );
    }

    #[test]
    fn a_copied_directory_gets_a_new_identity() {
        let directory = tempfile::tempdir().unwrap();
        let original = directory.path().join("thesis");
        std::fs::create_dir(&original).unwrap();
        std::fs::write(original.join("main.tex"), "\\documentclass{article}").unwrap();
        let copy = directory.path().join("thesis copy");
        std::fs::create_dir(&copy).unwrap();
        std::fs::copy(original.join("main.tex"), copy.join("main.tex")).unwrap();

        let recorded = identify_directory(&original).unwrap();
        let observed = identify_directory(&copy).unwrap();
        assert_ne!(recorded.identity.file, observed.identity.file);
        assert_eq!(recorded.identity.volume, observed.identity.volume);
        let expected = if recorded.identity.weak {
            IdentityMatch::Unknown
        } else {
            IdentityMatch::Different
        };
        assert_eq!(compare(&recorded.identity, &observed.identity), expected);
    }

    #[test]
    fn a_directory_recreated_at_the_same_path_gets_a_new_identity() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("thesis");
        std::fs::create_dir(&path).unwrap();
        let recorded = identify_directory(&path).unwrap();

        std::fs::rename(&path, directory.path().join("thesis-old")).unwrap();
        std::fs::create_dir(&path).unwrap();
        let observed = identify_directory(&path).unwrap();
        let expected = if recorded.identity.weak {
            IdentityMatch::Unknown
        } else {
            IdentityMatch::Different
        };
        assert_eq!(compare(&recorded.identity, &observed.identity), expected);
    }

    #[test]
    fn plain_metadata_tells_a_recreated_directory_apart_where_the_platform_allows() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("thesis");
        std::fs::create_dir(&path).unwrap();
        let recorded = identify_directory(&path).unwrap().identity;
        let same = std::fs::symlink_metadata(&path).unwrap();

        std::fs::rename(&path, directory.path().join("thesis-old")).unwrap();
        std::fs::create_dir(&path).unwrap();
        let recreated = std::fs::symlink_metadata(&path).unwrap();

        if cfg!(unix) && !recorded.weak {
            assert_eq!(quick_matches(&recorded, &same), Some(true));
            assert_eq!(quick_matches(&recorded, &recreated), Some(false));
        } else {
            assert_eq!(quick_matches(&recorded, &same), None);
            assert_eq!(quick_matches(&recorded, &recreated), None);
        }
        let mut weak = recorded;
        weak.weak = true;
        assert_eq!(quick_matches(&weak, &recreated), None);
    }

    #[test]
    fn local_temp_volumes_report_a_strong_identity() {
        let directory = tempfile::tempdir().unwrap();
        let observed = identify_directory(directory.path()).unwrap();
        assert!(!observed.identity.weak);
        assert_eq!(observed.volume_kind, VolumeKind::Local);
        if cfg!(any(target_os = "macos", windows)) {
            assert!(observed.identity.volume.is_some());
            assert!(observed.identity.birth_ns.is_some());
        }
    }

    #[test]
    fn the_reported_case_sensitivity_matches_the_temp_volume() {
        let directory = tempfile::tempdir().unwrap();
        std::fs::create_dir(directory.path().join("case-probe")).unwrap();
        let folds = directory.path().join("CASE-PROBE").exists();
        let observed = identify_directory(directory.path()).unwrap();
        let expected = if folds {
            CaseSensitivity::Insensitive
        } else {
            CaseSensitivity::Sensitive
        };
        assert_eq!(observed.case, expected);
    }

    #[test]
    fn files_symlinks_and_missing_paths_are_not_identified() {
        let directory = tempfile::tempdir().unwrap();
        let file = directory.path().join("main.tex");
        std::fs::write(&file, "x").unwrap();
        assert_eq!(
            identify_directory(&file).unwrap_err().kind(),
            io::ErrorKind::NotADirectory
        );
        assert_eq!(
            identify_directory(&directory.path().join("gone"))
                .unwrap_err()
                .kind(),
            io::ErrorKind::NotFound
        );
        if crate::paths::symlink_creation_is_permitted() {
            let target = directory.path().join("target");
            std::fs::create_dir(&target).unwrap();
            let link = directory.path().join("link");
            #[cfg(unix)]
            std::os::unix::fs::symlink(&target, &link).unwrap();
            #[cfg(windows)]
            std::os::windows::fs::symlink_dir(&target, &link).unwrap();
            assert!(identify_directory(&link).is_err());
            assert!(identify_directory(&link.join("")).is_err());
            assert!(identify_directory(&link.join(".")).is_err());
            assert_eq!(
                identify_directory(&target.join("")).unwrap(),
                identify_directory(&target).unwrap()
            );
        }
    }

    #[test]
    fn apple_volumes_without_persistent_ids_or_off_the_machine_are_weak() {
        let uuid = [
            0x6e, 0xc4, 0x98, 0x08, 0x1b, 0xb0, 0x4a, 0xc3, 0xb5, 0xd2, 0x66, 0xe3, 0xbd, 0x40,
            0xba, 0x38,
        ];
        let apfs = apple_volume_facts(
            true,
            Some(AppleVolumeAttributes {
                uuid: Some(uuid),
                persistent_ids: true,
            }),
            "apfs".into(),
            CaseSensitivity::Insensitive,
        );
        assert_eq!(
            apfs.id.as_deref(),
            Some("uuid:6EC49808-1BB0-4AC3-B5D2-66E3BD40BA38")
        );
        assert!(!apfs.weak);
        assert_eq!(apfs.kind, VolumeKind::Local);
        let exfat = apple_volume_facts(
            true,
            Some(AppleVolumeAttributes {
                uuid: Some(uuid),
                persistent_ids: false,
            }),
            "exfat".into(),
            CaseSensitivity::Insensitive,
        );
        assert!(exfat.weak);
        let smb = apple_volume_facts(
            false,
            Some(AppleVolumeAttributes {
                uuid: None,
                persistent_ids: false,
            }),
            "smbfs".into(),
            CaseSensitivity::Insensitive,
        );
        assert!(smb.weak);
        assert_eq!(smb.kind, VolumeKind::Network);
        assert_eq!(smb.id, None);
        let unreadable = apple_volume_facts(true, None, "apfs".into(), CaseSensitivity::Unknown);
        assert!(unreadable.weak);
    }

    #[test]
    fn linux_volume_types_map_to_weakness_and_case() {
        let ext4 = linux_volume_facts(0xef53, [0x1234, 0x5678]);
        assert_eq!(ext4.id.as_deref(), Some("fsid:0000123400005678"));
        assert!(!ext4.weak);
        assert_eq!(ext4.case, CaseSensitivity::Sensitive);
        let vfat = linux_volume_facts(0x4d44, [1, 2]);
        assert!(vfat.weak);
        assert_eq!(vfat.case, CaseSensitivity::Insensitive);
        let cifs = linux_volume_facts(0xff53_4d42, [0, 0]);
        assert!(cifs.weak);
        assert_eq!(cifs.kind, VolumeKind::Network);
        assert_eq!(cifs.id, None);
        let negative = linux_volume_facts(0x9123_683e, [-1, -2]);
        assert_eq!(negative.id.as_deref(), Some("fsid:fffffffffffffffe"));
    }

    #[test]
    fn windows_fat_family_and_remote_volumes_are_weak() {
        let ntfs = windows_volume_facts(
            0x1234,
            Some("NTFS".into()),
            false,
            CaseSensitivity::Insensitive,
        );
        assert_eq!(ntfs.id.as_deref(), Some("serial:0000000000001234"));
        assert!(!ntfs.weak);
        let exfat =
            windows_volume_facts(7, Some("exFAT".into()), false, CaseSensitivity::Insensitive);
        assert!(exfat.weak);
        let share =
            windows_volume_facts(7, Some("NTFS".into()), true, CaseSensitivity::Insensitive);
        assert!(share.weak);
        assert_eq!(share.kind, VolumeKind::Network);
        let unknown = windows_volume_facts(0, None, false, CaseSensitivity::Insensitive);
        assert!(unknown.weak);
        assert_eq!(unknown.id, None);
    }

    #[test]
    fn paths_compare_case_insensitively_only_when_the_volume_does() {
        let stored = Path::new("/Users/ada/Thesis/Chapters");
        let typed = Path::new("/Users/ada/thesis/chapters");
        assert!(same_path(stored, typed, CaseSensitivity::Insensitive));
        assert!(!same_path(stored, typed, CaseSensitivity::Sensitive));
        assert!(!same_path(stored, typed, CaseSensitivity::Unknown));
        assert!(path_is_within(
            typed,
            Path::new("/Users/ada/THESIS"),
            CaseSensitivity::Insensitive
        ));
        assert!(!path_is_within(
            typed,
            Path::new("/Users/ada/THESIS"),
            CaseSensitivity::Sensitive
        ));
        assert!(!path_is_within(
            Path::new("/Users/ada/thesis-2"),
            Path::new("/Users/ada/thesis"),
            CaseSensitivity::Insensitive
        ));
        assert!(path_is_within(stored, stored, CaseSensitivity::Sensitive));
    }

    #[cfg(target_os = "macos")]
    struct AttachedImage {
        mount: PathBuf,
        attached: bool,
    }

    #[cfg(target_os = "macos")]
    impl AttachedImage {
        fn detach(mut self) {
            self.attached = !detach_disk_image(&self.mount);
            assert!(!self.attached);
        }
    }

    #[cfg(target_os = "macos")]
    impl Drop for AttachedImage {
        fn drop(&mut self) {
            if self.attached {
                detach_disk_image(&self.mount);
            }
        }
    }

    #[cfg(target_os = "macos")]
    fn attach_disk_image(image: &Path, mount: &Path) -> AttachedImage {
        std::fs::create_dir_all(mount).unwrap();
        let status = std::process::Command::new("hdiutil")
            .args(["attach", "-nobrowse", "-mountpoint"])
            .arg(mount)
            .arg(image)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        AttachedImage {
            mount: mount.to_path_buf(),
            attached: true,
        }
    }

    #[cfg(target_os = "macos")]
    fn detach_disk_image(mount: &Path) -> bool {
        std::process::Command::new("hdiutil")
            .args(["detach", "-force"])
            .arg(mount)
            .stdout(std::process::Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    #[cfg(target_os = "macos")]
    fn create_disk_image(directory: &Path, file_system: &str) -> std::path::PathBuf {
        let image = directory.join("volume.dmg");
        let status = std::process::Command::new("hdiutil")
            .args([
                "create",
                "-size",
                "40m",
                "-volname",
                "PROBE",
                "-fs",
                file_system,
            ])
            .arg(&image)
            .stdout(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success());
        image
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "attaches disk images with hdiutil"]
    fn a_remounted_apfs_volume_keeps_the_identity_while_its_device_number_moves() {
        use std::os::unix::fs::MetadataExt as _;
        let directory = tempfile::tempdir().unwrap();
        let image = create_disk_image(directory.path(), "APFS");
        let mount = directory.path().join("mount");
        let attached = attach_disk_image(&image, &mount);
        let folder = mount.join("thesis");
        std::fs::create_dir(&folder).unwrap();
        let recorded = identify_directory(&folder).unwrap();
        let first_device = std::fs::metadata(&folder).unwrap().dev();
        attached.detach();

        let other = tempfile::tempdir().unwrap();
        let spacer = create_disk_image(other.path(), "APFS");
        let spacer_mount = other.path().join("mount");
        let spacer_attached = attach_disk_image(&spacer, &spacer_mount);
        let attached = attach_disk_image(&image, &mount);
        let observed = identify_directory(&folder).unwrap();
        let second_device = std::fs::metadata(&folder).unwrap().dev();
        attached.detach();
        spacer_attached.detach();

        assert!(!recorded.identity.weak);
        assert_eq!(
            compare(&recorded.identity, &observed.identity),
            IdentityMatch::FullMatch
        );
        assert_ne!(first_device, second_device);
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "attaches disk images with hdiutil"]
    fn an_exfat_volume_is_weak() {
        let directory = tempfile::tempdir().unwrap();
        let image = create_disk_image(directory.path(), "ExFAT");
        let mount = directory.path().join("mount");
        let attached = attach_disk_image(&image, &mount);
        let observed = identify_directory(&mount);
        attached.detach();
        let observed = observed.unwrap();
        assert!(observed.identity.weak);
        assert_eq!(observed.file_system, "exfat");
        assert_eq!(observed.volume_kind, VolumeKind::Local);
    }
}
