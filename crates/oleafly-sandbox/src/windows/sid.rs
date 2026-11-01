use std::os::windows::ffi::OsStrExt;

use sha2::{Digest, Sha256};
use windows_sys::Win32::Foundation::{GetLastError, LocalFree};
use windows_sys::Win32::Security::Authorization::{ConvertSidToStringSidW, ConvertStringSidToSidW};
use windows_sys::Win32::Security::{DeriveCapabilitySidsFromName, FreeSid, PSID};

use crate::SandboxError;

pub(crate) const RUNTIME_CAPABILITY: &str = "oleaflyRunRead";
pub(crate) const INTERNET_CLIENT: &str = "S-1-15-3-1";
pub(crate) const PRIVATE_NETWORK: &str = "S-1-15-3-3";

enum Free {
    Sid,
    Local,
}

pub(crate) struct OwnedSid {
    sid: PSID,
    free: Free,
}

// SAFETY: a SID is plain memory; the pointer is only freed on drop.
unsafe impl Send for OwnedSid {}

impl OwnedSid {
    pub(crate) fn from_profile(sid: PSID) -> Self {
        Self {
            sid,
            free: Free::Sid,
        }
    }

    pub(crate) fn as_psid(&self) -> PSID {
        self.sid
    }

    pub(crate) fn to_sddl(&self) -> Result<String, SandboxError> {
        let mut text = std::ptr::null_mut();
        // SAFETY: `self.sid` is a valid SID; the string is freed with LocalFree.
        unsafe {
            if ConvertSidToStringSidW(self.sid, &mut text) == 0 {
                return Err(SandboxError::Io(format!(
                    "Windows error {} reading a SID.",
                    GetLastError()
                )));
            }
            let mut length = 0;
            while *text.add(length) != 0 {
                length += 1;
            }
            let value = String::from_utf16_lossy(std::slice::from_raw_parts(text, length));
            LocalFree(text as *mut core::ffi::c_void);
            Ok(value)
        }
    }

    pub(crate) fn from_sddl(text: &str) -> Result<OwnedSid, SandboxError> {
        let wide: Vec<u16> = std::ffi::OsStr::new(text)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let mut sid: PSID = std::ptr::null_mut();
        // SAFETY: `wide` is NUL-terminated; the SID is freed with LocalFree.
        unsafe {
            if ConvertStringSidToSidW(wide.as_ptr(), &mut sid) == 0 {
                return Err(SandboxError::Invalid(format!("{text} is not a SID.")));
            }
        }
        Ok(OwnedSid {
            sid,
            free: Free::Local,
        })
    }
}

impl Drop for OwnedSid {
    fn drop(&mut self) {
        if self.sid.is_null() {
            return;
        }
        // SAFETY: freed exactly once, with the allocator that produced it.
        unsafe {
            match self.free {
                Free::Sid => {
                    FreeSid(self.sid);
                }
                Free::Local => {
                    LocalFree(self.sid);
                }
            }
        }
    }
}

fn hex_digest(text: &str, length: usize) -> String {
    let digest = Sha256::digest(text.as_bytes());
    digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>()[..length]
        .to_string()
}

/// `Oleafly.Task.<32 hex>`: 45 characters, within Windows' 64 and its
/// allowed characters.
pub(crate) fn container_name(owner: &str) -> String {
    format!("Oleafly.Task.{}", hex_digest(owner, 32))
}

pub(crate) fn project_capability(project: &str) -> String {
    format!("oleaflyProject{}", hex_digest(project, 16))
}

/// The capability SID Windows derives from a capability name.
pub(crate) fn capability_sid(name: &str) -> Result<OwnedSid, SandboxError> {
    let wide: Vec<u16> = std::ffi::OsStr::new(name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    let mut groups: *mut PSID = std::ptr::null_mut();
    let mut group_count = 0u32;
    let mut sids: *mut PSID = std::ptr::null_mut();
    let mut sid_count = 0u32;
    // SAFETY: Windows allocates both arrays and every SID with LocalAlloc.
    unsafe {
        if DeriveCapabilitySidsFromName(
            wide.as_ptr(),
            &mut groups,
            &mut group_count,
            &mut sids,
            &mut sid_count,
        ) == 0
        {
            return Err(SandboxError::Io(format!(
                "Windows error {} deriving the {name} capability.",
                GetLastError()
            )));
        }
        for index in 0..group_count as usize {
            LocalFree(*groups.add(index));
        }
        LocalFree(groups as *mut core::ffi::c_void);
        if sid_count == 0 {
            LocalFree(sids as *mut core::ffi::c_void);
            return Err(SandboxError::Io(format!(
                "Windows returned no SID for the {name} capability."
            )));
        }
        let first = *sids;
        for index in 1..sid_count as usize {
            LocalFree(*sids.add(index));
        }
        LocalFree(sids as *mut core::ffi::c_void);
        Ok(OwnedSid {
            sid: first,
            free: Free::Local,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn container_names_are_short_safe_and_stable() {
        let name = container_name("task:abc");
        assert!(name.len() <= 64 && name.starts_with("Oleafly.Task."));
        assert!(name
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '.'));
        assert_eq!(name, container_name("task:abc"));
        assert_ne!(name, container_name("task:abd"));
    }

    #[test]
    fn capability_sid_is_stable() {
        let first = capability_sid(RUNTIME_CAPABILITY)
            .unwrap()
            .to_sddl()
            .unwrap();
        let second = capability_sid(RUNTIME_CAPABILITY)
            .unwrap()
            .to_sddl()
            .unwrap();
        assert!(first.starts_with("S-1-15-3-1024-"), "{first}");
        assert_eq!(first, second);
    }
}
