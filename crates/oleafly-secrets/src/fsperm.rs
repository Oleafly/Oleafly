use std::path::Path;

pub fn harden_file(path: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    #[cfg(windows)]
    {
        let _ = windows::harden(path);
    }
    #[cfg(not(any(unix, windows)))]
    {
        let _ = path;
    }
}

#[cfg(windows)]
pub fn harden_file_checked(path: &Path) -> std::io::Result<()> {
    windows::harden(path)
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Authorization::{
        SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W, SET_ACCESS, SE_FILE_OBJECT,
        TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, TokenUser, DACL_SECURITY_INFORMATION, NO_INHERITANCE,
        PROTECTED_DACL_SECURITY_INFORMATION, TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::FILE_ALL_ACCESS;
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    fn user_token() -> io::Result<Vec<usize>> {
        let mut raw = null_mut();
        if unsafe { OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut raw) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let token = unsafe { OwnedHandle::from_raw_handle(raw) };
        let mut size = 0;
        unsafe { GetTokenInformation(token.as_raw_handle(), TokenUser, null_mut(), 0, &mut size) };
        if size == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut buffer = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
        if unsafe {
            GetTokenInformation(
                token.as_raw_handle(),
                TokenUser,
                buffer.as_mut_ptr().cast(),
                size,
                &mut size,
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(buffer)
    }

    pub(super) fn harden(path: &Path) -> io::Result<()> {
        let mut path: Vec<u16> = path.as_os_str().encode_wide().collect();
        if path.contains(&0) {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "path contains NUL",
            ));
        }
        path.push(0);
        let token = user_token()?;
        let user = unsafe { &*token.as_ptr().cast::<TOKEN_USER>() };
        let entry = EXPLICIT_ACCESS_W {
            grfAccessPermissions: FILE_ALL_ACCESS,
            grfAccessMode: SET_ACCESS,
            grfInheritance: NO_INHERITANCE,
            Trustee: TRUSTEE_W {
                TrusteeForm: TRUSTEE_IS_SID,
                TrusteeType: TRUSTEE_IS_USER,
                ptstrName: user.User.Sid.cast(),
                ..Default::default()
            },
        };
        let mut acl = null_mut();
        let status = unsafe { SetEntriesInAclW(1, &entry, null(), &mut acl) };
        if status != 0 {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        let status = unsafe {
            SetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                acl,
                null(),
            )
        };
        unsafe { LocalFree(acl.cast()) };
        if status != 0 {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        Ok(())
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use windows_sys::Win32::Security::Authorization::GetNamedSecurityInfoW;
        use windows_sys::Win32::Security::{
            EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE, SE_DACL_PROTECTED,
        };

        #[test]
        fn hardening_installs_only_the_current_user_and_preserves_unicode_file() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("secret with spaces — 日本語.txt");
            std::fs::write(&path, "synthetic secret").unwrap();
            for _ in 0..2 {
                harden(&path).unwrap();
                let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
                let mut acl = null_mut();
                let mut descriptor = null_mut();
                assert_eq!(
                    unsafe {
                        GetNamedSecurityInfoW(
                            wide.as_ptr(),
                            SE_FILE_OBJECT,
                            DACL_SECURITY_INFORMATION,
                            null_mut(),
                            null_mut(),
                            &mut acl,
                            null_mut(),
                            &mut descriptor,
                        )
                    },
                    0
                );
                let token = user_token().unwrap();
                let user = unsafe { &*token.as_ptr().cast::<TOKEN_USER>() };
                let mut control = 0;
                let mut revision = 0;
                let mut ace = null_mut();
                unsafe {
                    assert!(!acl.is_null());
                    assert_eq!((*acl).AceCount, 1);
                    assert_ne!(GetAce(acl, 0, &mut ace), 0);
                    let ace = &*ace.cast::<ACCESS_ALLOWED_ACE>();
                    assert_eq!(ace.Header.AceType, 0);
                    assert_eq!(ace.Mask, FILE_ALL_ACCESS);
                    assert_ne!(
                        EqualSid(
                            std::ptr::addr_of!(ace.SidStart).cast_mut().cast(),
                            user.User.Sid
                        ),
                        0
                    );
                    assert_ne!(
                        GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                        0
                    );
                    assert_ne!(control & SE_DACL_PROTECTED, 0);
                    LocalFree(descriptor);
                }
                assert_eq!(std::fs::read_to_string(&path).unwrap(), "synthetic secret");
                std::fs::write(&path, "synthetic secret").unwrap();
            }
        }

        #[test]
        fn missing_file_returns_an_error_without_creating_it() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("missing");
            assert!(harden(&path).is_err());
            super::super::harden_file(&path);
            assert!(!path.exists());
        }
    }
}
