//! Folder access entries for sandboxed tasks. A DACL write on a folder walks
//! its whole subtree, so each root gets one inheritable entry, checked first
//! and skipped when present (unless an earlier attempt was cut short: then
//! the walk is made again). Traverse entries on ancestors are written with
//! `SetFileSecurityW`, which does not walk. A protected file gets a protected
//! DACL without the task. A protected or hidden folder gets an inheritable
//! deny entry for the task, and the folder that holds it a deny entry for
//! `FILE_DELETE_CHILD` on itself only: with that right on the parent, a task
//! could delete or rename the protected entry whatever its own access list
//! says, and put a new one in its place.
use std::os::windows::ffi::OsStrExt;
use std::path::Path;

use windows_sys::Win32::Foundation::{GetLastError, LocalFree, ERROR_SUCCESS};
use windows_sys::Win32::Security::Authorization::{
    GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, DENY_ACCESS, EXPLICIT_ACCESS_W,
    GRANT_ACCESS, NO_MULTIPLE_TRUSTEE, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_UNKNOWN,
    TRUSTEE_W,
};
use windows_sys::Win32::Security::{
    AddAce, EqualSid, GetAce, InitializeAcl, InitializeSecurityDescriptor, SetFileSecurityW,
    SetSecurityDescriptorDacl, ACCESS_ALLOWED_ACE, ACE_FLAGS, ACE_HEADER, ACL,
    DACL_SECURITY_INFORMATION, INHERITED_ACE, INHERIT_ONLY_ACE, NO_INHERITANCE,
    PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_DESCRIPTOR,
    SUB_CONTAINERS_AND_OBJECTS_INHERIT,
};
use windows_sys::Win32::Storage::FileSystem::{
    DELETE, FILE_APPEND_DATA, FILE_DELETE_CHILD, FILE_GENERIC_EXECUTE, FILE_GENERIC_READ,
    FILE_GENERIC_WRITE, FILE_READ_ATTRIBUTES, FILE_TRAVERSE, FILE_WRITE_ATTRIBUTES,
    FILE_WRITE_DATA, FILE_WRITE_EA, SYNCHRONIZE,
};
use windows_sys::Win32::System::SystemServices::{
    ACCESS_ALLOWED_ACE_TYPE, ACCESS_DENIED_ACE_TYPE, SECURITY_DESCRIPTOR_REVISION,
};

use super::sid::OwnedSid;
use crate::SandboxError;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Access {
    Read,
    ReadWrite,
    Traverse,
}

impl Access {
    fn mask(self) -> u32 {
        match self {
            Self::Read => FILE_GENERIC_READ | FILE_GENERIC_EXECUTE,
            Self::ReadWrite => {
                FILE_GENERIC_READ
                    | FILE_GENERIC_EXECUTE
                    | FILE_GENERIC_WRITE
                    | DELETE
                    | FILE_DELETE_CHILD
            }
            Self::Traverse => FILE_TRAVERSE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
        }
    }
}

/// What a deny entry takes from the task.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Deny {
    /// Writing, adding, deleting and renaming; reading stays.
    Write,
    /// Everything.
    All,
}

impl Deny {
    fn mask(self) -> u32 {
        // Not FILE_GENERIC_WRITE: it carries SYNCHRONIZE and READ_CONTROL,
        // and denying those would stop the task from opening the folder
        // for reading too.
        let write = FILE_WRITE_DATA
            | FILE_APPEND_DATA
            | FILE_WRITE_EA
            | FILE_WRITE_ATTRIBUTES
            | DELETE
            | FILE_DELETE_CHILD;
        match self {
            Self::Write => write,
            Self::All => write | FILE_GENERIC_READ | FILE_GENERIC_WRITE | FILE_GENERIC_EXECUTE,
        }
    }
}

/// A path for the security calls: the `\\?\` form at 260 characters or more.
fn wide_path(path: &Path) -> Vec<u16> {
    let plain = crate::plain_path(path);
    let text = plain.as_os_str().to_string_lossy();
    let long = text.encode_utf16().count() >= 260 && !text.starts_with(r"\\?\");
    let text = if long {
        if let Some(share) = text.strip_prefix(r"\\") {
            format!(r"\\?\UNC\{share}")
        } else {
            format!(r"\\?\{text}")
        }
    } else {
        text.into_owned()
    };
    std::ffi::OsStr::new(&text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn error(step: &str, path: &Path, code: u32) -> SandboxError {
    SandboxError::Io(format!("Windows error {code} {step} {}.", path.display()))
}

/// The object's DACL and the descriptor that owns it (freed with LocalFree).
struct Dacl {
    dacl: *mut ACL,
    descriptor: PSECURITY_DESCRIPTOR,
}

impl Drop for Dacl {
    fn drop(&mut self) {
        if !self.descriptor.is_null() {
            // SAFETY: allocated by GetNamedSecurityInfoW.
            unsafe {
                LocalFree(self.descriptor);
            }
        }
    }
}

fn read_dacl(path: &Path) -> Result<Dacl, SandboxError> {
    let name = wide_path(path);
    let mut dacl: *mut ACL = std::ptr::null_mut();
    let mut descriptor: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
    // SAFETY: `name` is NUL-terminated; the descriptor is freed by `Dacl`.
    let code = unsafe {
        GetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            &mut dacl,
            std::ptr::null_mut(),
            &mut descriptor,
        )
    };
    if code != ERROR_SUCCESS {
        return Err(error("reading the access list of", path, code));
    }
    Ok(Dacl { dacl, descriptor })
}

/// Whether `path` already has an allow entry for `sid` covering `access`.
pub(crate) fn has_allow(path: &Path, sid: &OwnedSid, access: Access) -> Result<bool, SandboxError> {
    let dacl = read_dacl(path)?;
    if dacl.dacl.is_null() {
        // A missing DACL grants everyone everything.
        return Ok(true);
    }
    let wanted = access.mask();
    // SAFETY: `dacl.dacl` points to a valid ACL owned by `dacl`.
    unsafe {
        let count = (*dacl.dacl).AceCount;
        for index in 0..u32::from(count) {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if GetAce(dacl.dacl, index, &mut ace) == 0 {
                continue;
            }
            let allowed = ace as *const ACCESS_ALLOWED_ACE;
            if u32::from((*allowed).Header.AceType) != ACCESS_ALLOWED_ACE_TYPE
                || u32::from((*allowed).Header.AceFlags) & INHERIT_ONLY_ACE != 0
            {
                continue;
            }
            let ace_sid = std::ptr::addr_of!((*allowed).SidStart) as PSID;
            if EqualSid(ace_sid, sid.as_psid()) != 0 && (*allowed).Mask & wanted == wanted {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn explicit(sid: &OwnedSid, mode: i32, mask: u32, inheritance: ACE_FLAGS) -> EXPLICIT_ACCESS_W {
    EXPLICIT_ACCESS_W {
        grfAccessPermissions: mask,
        grfAccessMode: mode,
        grfInheritance: inheritance,
        Trustee: TRUSTEE_W {
            pMultipleTrustee: std::ptr::null_mut(),
            MultipleTrusteeOperation: NO_MULTIPLE_TRUSTEE,
            TrusteeForm: TRUSTEE_IS_SID,
            TrusteeType: TRUSTEE_IS_UNKNOWN,
            ptstrName: sid.as_psid() as *mut u16,
        },
    }
}

/// The DACL with `entry` merged in (freed with LocalFree by the caller).
fn merged(path: &Path, entry: &EXPLICIT_ACCESS_W) -> Result<(*mut ACL, Dacl), SandboxError> {
    let current = read_dacl(path)?;
    let mut updated: *mut ACL = std::ptr::null_mut();
    // SAFETY: the old ACL stays alive in `current` during the call.
    let code = unsafe { SetEntriesInAclW(1, entry, current.dacl, &mut updated) };
    if code != ERROR_SUCCESS {
        return Err(error("updating the access list of", path, code));
    }
    Ok((updated, current))
}

fn write_named(path: &Path, dacl: *mut ACL, extra: u32) -> Result<(), SandboxError> {
    let result = set_named(path, dacl, extra);
    // SAFETY: allocated by SetEntriesInAclW.
    unsafe {
        LocalFree(dacl as *mut core::ffi::c_void);
    }
    result
}

/// Writes `dacl` to `path`; the system carries inheritable changes to
/// everything below it. The caller owns `dacl`.
fn set_named(path: &Path, dacl: *const ACL, extra: u32) -> Result<(), SandboxError> {
    let name = wide_path(path);
    // SAFETY: `name` is NUL-terminated and `dacl` a valid ACL.
    let code = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | extra,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            dacl,
            std::ptr::null(),
        )
    };
    if code != ERROR_SUCCESS {
        return Err(error("writing the access list of", path, code));
    }
    Ok(())
}

/// Writes a DACL to this object only (no walk below it).
fn write_this_only(path: &Path, dacl: *mut ACL) -> Result<(), SandboxError> {
    let result = set_this_only(path, dacl);
    // SAFETY: allocated by SetEntriesInAclW.
    unsafe {
        LocalFree(dacl as *mut core::ffi::c_void);
    }
    result
}

/// Writes `dacl` to `path` alone. The caller owns `dacl`.
fn set_this_only(path: &Path, dacl: *const ACL) -> Result<(), SandboxError> {
    let name = wide_path(path);
    // SAFETY: the descriptor lives on the stack for the call and `dacl`
    // outlives it.
    let result = unsafe {
        let mut descriptor: SECURITY_DESCRIPTOR = std::mem::zeroed();
        let descriptor_ptr = &mut descriptor as *mut SECURITY_DESCRIPTOR as PSECURITY_DESCRIPTOR;
        let ok = InitializeSecurityDescriptor(descriptor_ptr, SECURITY_DESCRIPTOR_REVISION) != 0
            && SetSecurityDescriptorDacl(descriptor_ptr, 1, dacl, 0) != 0
            && SetFileSecurityW(name.as_ptr(), DACL_SECURITY_INFORMATION, descriptor_ptr) != 0;
        let code = windows_sys::Win32::Foundation::GetLastError();
        if ok {
            Ok(())
        } else {
            Err(code)
        }
    };
    result.map_err(|code| error("writing the access list of", path, code))
}

/// Grants `access` to `sid` on `path` and everything below it. An entry
/// that is on `path` already ends the call, unless `force`: the entry says
/// nothing about the files below it when an earlier walk was cut short.
pub(crate) fn grant(
    path: &Path,
    sid: &OwnedSid,
    access: Access,
    force: bool,
) -> Result<(), SandboxError> {
    if !force && has_allow(path, sid, access)? {
        return Ok(());
    }
    let inheritance = if path.is_dir() {
        SUB_CONTAINERS_AND_OBJECTS_INHERIT
    } else {
        NO_INHERITANCE
    };
    let entry = explicit(sid, GRANT_ACCESS, access.mask(), inheritance);
    let (dacl, _current) = merged(path, &entry)?;
    write_named(path, dacl, 0)
}

/// Keeps `sid` out of `folder` and everything below it as far as `kind` says:
/// an inheritable deny entry, which beats the grants the folder inherits.
pub(crate) fn deny(folder: &Path, sid: &OwnedSid, kind: Deny) -> Result<(), SandboxError> {
    let entry = explicit(
        sid,
        DENY_ACCESS,
        kind.mask(),
        SUB_CONTAINERS_AND_OBJECTS_INHERIT,
    );
    let (dacl, _current) = merged(folder, &entry)?;
    write_named(folder, dacl, 0)
}

/// Keeps `sid` from deleting or renaming anything in `folder` through the
/// folder itself (the entries on the files stay as they are, so the task can
/// still delete what it may delete). This folder only, no walk.
pub(crate) fn deny_delete_child(folder: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
    let entry = explicit(sid, DENY_ACCESS, FILE_DELETE_CHILD, NO_INHERITANCE);
    let (dacl, _current) = merged(folder, &entry)?;
    write_this_only(folder, dacl)
}

/// Lets `sid` pass through `dir` to a granted folder below it.
pub(crate) fn grant_traverse(dir: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
    if has_allow(dir, sid, Access::Traverse)? {
        return Ok(());
    }
    let entry = explicit(sid, GRANT_ACCESS, Access::Traverse.mask(), NO_INHERITANCE);
    let (dacl, _current) = merged(dir, &entry)?;
    write_this_only(dir, dacl)
}

/// Removes `sid`'s entries from `path` and everything below it: its allow
/// entries and its deny entries alike (REVOKE_ACCESS would leave the deny
/// entries in place).
pub(crate) fn revoke(path: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
    let current = read_dacl(path)?;
    if current.dacl.is_null() {
        return Ok(());
    }
    let acl = without_own_entries(&current, sid)
        .map_err(|code| error("updating the access list of", path, code))?;
    set_named(path, acl.as_ptr().cast::<ACL>(), 0)
}

/// Removes `sid`'s entries from `dir` only: a traverse grant and the
/// folder-only delete deny.
pub(crate) fn revoke_traverse(dir: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
    let current = read_dacl(dir)?;
    if current.dacl.is_null() {
        return Ok(());
    }
    let acl = without_own_entries(&current, sid)
        .map_err(|code| error("updating the access list of", dir, code))?;
    set_this_only(dir, acl.as_ptr().cast::<ACL>())
}

/// A copy of `dacl` without the allow and deny entries set on it for `sid`.
/// Inherited entries stay as they are: writing the copy recomputes them from
/// the parent. Held in `u32`s because an ACL and its entries need 4-byte
/// alignment.
fn without_own_entries(dacl: &Dacl, sid: &OwnedSid) -> Result<Vec<u32>, u32> {
    // SAFETY: `dacl.dacl` is a valid ACL owned by `dacl` (the caller checked
    // it isn't null); each entry is read within its own AceSize and copied
    // into an aligned buffer before AddAce reads it.
    unsafe {
        let source = &*dacl.dacl;
        let revision = u32::from(source.AclRevision);
        let size = u32::from(source.AclSize);
        let mut buffer = vec![0u32; (size as usize).div_ceil(4)];
        let acl = buffer.as_mut_ptr().cast::<ACL>();
        if InitializeAcl(acl, size, revision) == 0 {
            return Err(GetLastError());
        }
        for index in 0..u32::from(source.AceCount) {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if GetAce(dacl.dacl, index, &mut ace) == 0 {
                return Err(GetLastError());
            }
            let header = &*ace.cast::<ACE_HEADER>();
            let kind = u32::from(header.AceType);
            let own = u32::from(header.AceFlags) & INHERITED_ACE == 0;
            if own && (kind == ACCESS_ALLOWED_ACE_TYPE || kind == ACCESS_DENIED_ACE_TYPE) {
                // Both entry types put the SID at the same place.
                let entry = ace.cast::<ACCESS_ALLOWED_ACE>();
                let ace_sid = std::ptr::addr_of!((*entry).SidStart) as PSID;
                if EqualSid(ace_sid, sid.as_psid()) != 0 {
                    continue;
                }
            }
            let length = usize::from(header.AceSize);
            let mut copy = vec![0u32; length.div_ceil(4)];
            std::ptr::copy_nonoverlapping(ace.cast::<u8>(), copy.as_mut_ptr().cast::<u8>(), length);
            if AddAce(acl, revision, u32::MAX, copy.as_ptr().cast(), length as u32) == 0 {
                return Err(GetLastError());
            }
        }
        Ok(buffer)
    }
}

/// Keeps `sid` from writing a protected file inside a writable folder: the
/// file gets a protected DACL with its current entries minus the task's.
/// The folder's grant reaches the file as an inherited entry, which
/// REVOKE_ACCESS leaves in place and protecting a DACL keeps as an explicit
/// one, so the entries are copied by hand without the task's.
pub(crate) fn exclude_file(file: &Path, sid: &OwnedSid) -> Result<(), SandboxError> {
    if file.is_dir() {
        return Err(SandboxError::Invalid(format!(
            "{} is a folder; only files can be excluded.",
            file.display()
        )));
    }
    let current = read_dacl(file)?;
    if current.dacl.is_null() {
        // No DACL grants everyone everything; an empty protected one would
        // lock everyone out instead, the user included.
        return Err(SandboxError::Invalid(format!(
            "{} has no access list, so the task can't be kept out of it.",
            file.display()
        )));
    }
    let acl = without_sid(&current, sid)
        .map_err(|code| error("updating the access list of", file, code))?;
    let name = wide_path(file);
    // SAFETY: `name` is NUL-terminated and `acl` holds a valid ACL for the call.
    let code = unsafe {
        SetNamedSecurityInfoW(
            name.as_ptr(),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            acl.as_ptr().cast::<ACL>(),
            std::ptr::null(),
        )
    };
    if code != ERROR_SUCCESS {
        return Err(error("writing the access list of", file, code));
    }
    Ok(())
}

/// A copy of `dacl` without `sid`'s allow and deny entries, every entry
/// marked explicit for a protected DACL. Held in `u32`s because an ACL and
/// its entries need 4-byte alignment.
fn without_sid(dacl: &Dacl, sid: &OwnedSid) -> Result<Vec<u32>, u32> {
    // SAFETY: `dacl.dacl` is a valid ACL owned by `dacl` (the caller checked
    // it isn't null); each entry is read within its own AceSize and copied
    // into an aligned buffer before AddAce reads it.
    unsafe {
        let source = &*dacl.dacl;
        let revision = u32::from(source.AclRevision);
        let size = u32::from(source.AclSize);
        let mut buffer = vec![0u32; (size as usize).div_ceil(4)];
        let acl = buffer.as_mut_ptr().cast::<ACL>();
        if InitializeAcl(acl, size, revision) == 0 {
            return Err(GetLastError());
        }
        for index in 0..u32::from(source.AceCount) {
            let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
            if GetAce(dacl.dacl, index, &mut ace) == 0 {
                return Err(GetLastError());
            }
            let header = &*ace.cast::<ACE_HEADER>();
            let kind = u32::from(header.AceType);
            if kind == ACCESS_ALLOWED_ACE_TYPE || kind == ACCESS_DENIED_ACE_TYPE {
                // Both entry types put the SID at the same place.
                let entry = ace.cast::<ACCESS_ALLOWED_ACE>();
                let ace_sid = std::ptr::addr_of!((*entry).SidStart) as PSID;
                if EqualSid(ace_sid, sid.as_psid()) != 0 {
                    continue;
                }
            }
            let length = usize::from(header.AceSize);
            let mut copy = vec![0u32; length.div_ceil(4)];
            std::ptr::copy_nonoverlapping(ace.cast::<u8>(), copy.as_mut_ptr().cast::<u8>(), length);
            let copied = &mut *copy.as_mut_ptr().cast::<ACE_HEADER>();
            copied.AceFlags &= !(INHERITED_ACE as u8);
            if AddAce(acl, revision, u32::MAX, copy.as_ptr().cast(), length as u32) == 0 {
                return Err(GetLastError());
            }
        }
        Ok(buffer)
    }
}

#[cfg(test)]
mod tests {
    use super::super::sid::{capability_sid, RUNTIME_CAPABILITY};
    use super::*;

    fn ace_count(path: &Path) -> u16 {
        let dacl = read_dacl(path).unwrap();
        // SAFETY: the ACL is owned by `dacl`.
        unsafe { (*dacl.dacl).AceCount }
    }

    /// Whether `path` has a deny entry for `sid` covering all of `wanted`.
    fn has_deny(path: &Path, sid: &OwnedSid, wanted: u32) -> bool {
        let dacl = read_dacl(path).unwrap();
        if dacl.dacl.is_null() {
            return false;
        }
        // SAFETY: `dacl.dacl` points to a valid ACL owned by `dacl`.
        unsafe {
            for index in 0..u32::from((*dacl.dacl).AceCount) {
                let mut ace: *mut core::ffi::c_void = std::ptr::null_mut();
                if GetAce(dacl.dacl, index, &mut ace) == 0 {
                    continue;
                }
                let denied = ace as *const ACCESS_ALLOWED_ACE;
                if u32::from((*denied).Header.AceType) != ACCESS_DENIED_ACE_TYPE {
                    continue;
                }
                let ace_sid = std::ptr::addr_of!((*denied).SidStart) as PSID;
                if EqualSid(ace_sid, sid.as_psid()) != 0 && (*denied).Mask & wanted == wanted {
                    return true;
                }
            }
        }
        false
    }

    #[test]
    fn deny_write_reaches_the_files_below_and_revoke_clears_it() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("config");
        std::fs::write(&child, "x").unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant(dir.path(), &sid, Access::ReadWrite, false).unwrap();
        deny(dir.path(), &sid, Deny::Write).unwrap();
        let write = Deny::Write.mask();
        assert!(has_deny(dir.path(), &sid, write));
        assert!(has_deny(&child, &sid, write));
        // Reading is not denied.
        assert!(!has_deny(dir.path(), &sid, FILE_GENERIC_READ));
        revoke(dir.path(), &sid).unwrap();
        assert!(!has_deny(dir.path(), &sid, write));
        assert!(!has_deny(&child, &sid, write));
    }

    #[test]
    fn deny_delete_child_stays_on_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("config");
        std::fs::write(&child, "x").unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant(dir.path(), &sid, Access::ReadWrite, false).unwrap();
        deny_delete_child(dir.path(), &sid).unwrap();
        assert!(has_deny(dir.path(), &sid, FILE_DELETE_CHILD));
        assert!(!has_deny(&child, &sid, FILE_DELETE_CHILD));
        revoke_traverse(dir.path(), &sid).unwrap();
        assert!(!has_deny(dir.path(), &sid, FILE_DELETE_CHILD));
        revoke(dir.path(), &sid).unwrap();
    }

    #[test]
    fn grant_revoke_round_trip() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("child.txt");
        std::fs::write(&child, "x").unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant(dir.path(), &sid, Access::Read, false).unwrap();
        assert!(has_allow(dir.path(), &sid, Access::Read).unwrap());
        assert!(has_allow(&child, &sid, Access::Read).unwrap());
        revoke(dir.path(), &sid).unwrap();
        assert!(!has_allow(dir.path(), &sid, Access::Read).unwrap());
    }

    #[test]
    fn grant_is_skipped_when_present() {
        let dir = tempfile::tempdir().unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant(dir.path(), &sid, Access::Read, false).unwrap();
        let count = ace_count(dir.path());
        grant(dir.path(), &sid, Access::Read, false).unwrap();
        assert_eq!(ace_count(dir.path()), count);
        // A forced grant walks again but does not add a second entry.
        grant(dir.path(), &sid, Access::Read, true).unwrap();
        assert_eq!(ace_count(dir.path()), count);
        revoke(dir.path(), &sid).unwrap();
    }

    #[test]
    fn traverse_does_not_propagate() {
        let dir = tempfile::tempdir().unwrap();
        let child = dir.path().join("child.txt");
        std::fs::write(&child, "x").unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant_traverse(dir.path(), &sid).unwrap();
        assert!(!has_allow(&child, &sid, Access::Traverse).unwrap());
        revoke_traverse(dir.path(), &sid).unwrap();
    }

    #[test]
    fn exclude_file_drops_inherited_allow() {
        let dir = tempfile::tempdir().unwrap();
        let protected = dir.path().join(".git");
        let other = dir.path().join("a.txt");
        std::fs::write(&protected, "gitdir: x").unwrap();
        std::fs::write(&other, "x").unwrap();
        let sid = capability_sid(RUNTIME_CAPABILITY).unwrap();
        grant(dir.path(), &sid, Access::ReadWrite, false).unwrap();
        exclude_file(&protected, &sid).unwrap();
        assert!(!has_allow(&protected, &sid, Access::ReadWrite).unwrap());
        assert!(has_allow(&other, &sid, Access::ReadWrite).unwrap());
        revoke(dir.path(), &sid).unwrap();
    }
}
