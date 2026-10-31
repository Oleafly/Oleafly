//! AppContainer profiles: one per task, created on first use and deleted
//! when the task goes away. Callers hold the ledger lock (concurrent creates
//! were seen to remove a profile for a moment).
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use windows_sys::Win32::Security::Isolation::{
    CreateAppContainerProfile, DeleteAppContainerProfile,
    DeriveAppContainerSidFromAppContainerName, GetAppContainerFolderPath,
};
use windows_sys::Win32::Security::PSID;
use windows_sys::Win32::System::Com::CoTaskMemFree;

use super::sid::OwnedSid;
use crate::SandboxError;

const ALREADY_EXISTS: i32 = 0x800700B7_u32 as i32;
const NOT_FOUND: [i32; 2] = [0x80070002_u32 as i32, 0x80070003_u32 as i32];

fn wide(text: &str) -> Vec<u16> {
    std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

fn derive(name: &str) -> Result<OwnedSid, SandboxError> {
    let name = wide(name);
    let mut sid: PSID = std::ptr::null_mut();
    // SAFETY: `name` is NUL-terminated; the SID is freed with FreeSid.
    let hr = unsafe { DeriveAppContainerSidFromAppContainerName(name.as_ptr(), &mut sid) };
    if hr < 0 {
        return Err(SandboxError::Io(format!(
            "Windows error 0x{:08X} naming a task profile.",
            hr as u32
        )));
    }
    Ok(OwnedSid::from_profile(sid))
}

pub(crate) fn folder(sid: &OwnedSid) -> Option<PathBuf> {
    let text = wide(&sid.to_sddl().ok()?);
    let mut path = std::ptr::null_mut();
    // SAFETY: `text` is NUL-terminated; the path is freed with CoTaskMemFree.
    unsafe {
        if GetAppContainerFolderPath(text.as_ptr(), &mut path) < 0 || path.is_null() {
            return None;
        }
        let mut length = 0;
        while *path.add(length) != 0 {
            length += 1;
        }
        let value = String::from_utf16_lossy(std::slice::from_raw_parts(path, length));
        CoTaskMemFree(path as *const core::ffi::c_void);
        Some(PathBuf::from(value))
    }
}

pub(crate) fn ensure(name: &str) -> Result<OwnedSid, SandboxError> {
    let existing = derive(name)?;
    if folder(&existing).is_some() {
        return Ok(existing);
    }
    let wide_name = wide(name);
    let display = wide("Oleafly task");
    let description = wide("Runs commands for one Oleafly research task");
    let mut sid: PSID = std::ptr::null_mut();
    // SAFETY: all strings are NUL-terminated; no capabilities are passed.
    let hr = unsafe {
        CreateAppContainerProfile(
            wide_name.as_ptr(),
            display.as_ptr(),
            description.as_ptr(),
            std::ptr::null(),
            0,
            &mut sid,
        )
    };
    if hr == ALREADY_EXISTS {
        return derive(name);
    }
    if hr < 0 {
        return Err(SandboxError::Io(format!(
            "Windows error 0x{:08X} creating the task's sandbox profile.",
            hr as u32
        )));
    }
    Ok(OwnedSid::from_profile(sid))
}

pub(crate) fn delete(name: &str) -> Result<(), SandboxError> {
    let name = wide(name);
    // SAFETY: `name` is NUL-terminated.
    let hr = unsafe { DeleteAppContainerProfile(name.as_ptr()) };
    if hr >= 0 || NOT_FOUND.contains(&hr) {
        Ok(())
    } else {
        Err(SandboxError::Io(format!(
            "Windows error 0x{:08X} deleting a task profile.",
            hr as u32
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_round_trip() {
        let name = format!("Oleafly.Test.{:016x}", rand_suffix());
        let sid = ensure(&name).unwrap().to_sddl().unwrap();
        assert!(sid.starts_with("S-1-15-2-"), "{sid}");
        assert_eq!(ensure(&name).unwrap().to_sddl().unwrap(), sid);
        delete(&name).unwrap();
        assert!(folder(&derive(&name).unwrap()).is_none());
        delete(&name).unwrap();
    }

    fn rand_suffix() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos() as u64)
            .unwrap_or(7)
    }
}
