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

pub fn create_private_dir(path: &Path) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        windows::create_private_dir(path)
    }
    #[cfg(not(windows))]
    {
        std::fs::create_dir_all(path)
    }
}

pub fn owned_by_current_user(path: &Path) -> bool {
    #[cfg(windows)]
    {
        windows::owned_by_current_user(path).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        true
    }
}

#[cfg(windows)]
mod windows {
    use std::io;
    use std::os::windows::ffi::OsStrExt;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle};
    use std::path::Path;
    use std::ptr::{null, null_mut};
    use windows_sys::Win32::Foundation::{LocalFree, ERROR_ALREADY_EXISTS};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        GetNamedSecurityInfoW, SetEntriesInAclW, SetNamedSecurityInfoW, EXPLICIT_ACCESS_W,
        SDDL_REVISION_1, SET_ACCESS, SE_FILE_OBJECT, TRUSTEE_IS_SID, TRUSTEE_IS_USER, TRUSTEE_W,
    };
    use windows_sys::Win32::Security::{
        EqualSid, GetTokenInformation, IsWellKnownSid, TokenUser, WinBuiltinAdministratorsSid,
        WinLocalSystemSid, DACL_SECURITY_INFORMATION, NO_INHERITANCE, OWNER_SECURITY_INFORMATION,
        PROTECTED_DACL_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR, PSID, SECURITY_ATTRIBUTES,
        TOKEN_QUERY, TOKEN_USER,
    };
    use windows_sys::Win32::Storage::FileSystem::{CreateDirectoryW, FILE_ALL_ACCESS};
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    struct LocalDescriptor(PSECURITY_DESCRIPTOR);

    impl Drop for LocalDescriptor {
        fn drop(&mut self) {
            unsafe { LocalFree(self.0.cast()) };
        }
    }

    fn sid_text(sid: PSID) -> io::Result<String> {
        let mut text = null_mut();
        if unsafe { ConvertSidToStringSidW(sid, &mut text) } == 0 {
            return Err(io::Error::last_os_error());
        }
        let mut length = 0;
        while unsafe { *text.add(length) } != 0 {
            length += 1;
        }
        let value = String::from_utf16_lossy(unsafe { std::slice::from_raw_parts(text, length) });
        unsafe { LocalFree(text.cast()) };
        Ok(value)
    }

    fn private_folder_descriptor(user: PSID) -> io::Result<LocalDescriptor> {
        let sddl: Vec<u16> = format!(
            "D:P(A;OICI;FA;;;{})(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)",
            sid_text(user)?
        )
        .encode_utf16()
        .chain(Some(0))
        .collect();
        let mut descriptor = null_mut();
        if unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                null_mut(),
            )
        } == 0
        {
            return Err(io::Error::last_os_error());
        }
        Ok(LocalDescriptor(descriptor))
    }

    fn owned_here(path: &[u16], user: PSID) -> io::Result<bool> {
        let mut owner = null_mut();
        let mut descriptor = null_mut();
        let status = unsafe {
            GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                OWNER_SECURITY_INFORMATION,
                &mut owner,
                null_mut(),
                null_mut(),
                null_mut(),
                &mut descriptor,
            )
        };
        if status != 0 {
            return Err(io::Error::from_raw_os_error(status as i32));
        }
        let _descriptor = LocalDescriptor(descriptor);
        Ok(unsafe {
            EqualSid(owner, user) != 0
                || IsWellKnownSid(owner, WinBuiltinAdministratorsSid) != 0
                || IsWellKnownSid(owner, WinLocalSystemSid) != 0
        })
    }

    pub(super) fn create_private_dir(path: &Path) -> io::Result<()> {
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let token = user_token()?;
        let user = unsafe { &*token.as_ptr().cast::<TOKEN_USER>() }.User.Sid;
        let descriptor = private_folder_descriptor(user)?;
        let attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor.0,
            bInheritHandle: 0,
        };
        if unsafe { CreateDirectoryW(wide.as_ptr(), &attributes) } != 0 {
            return Ok(());
        }
        let error = io::Error::last_os_error();
        if error.raw_os_error() != Some(ERROR_ALREADY_EXISTS as i32) {
            return Err(error);
        }
        let reused = std::fs::symlink_metadata(path)?;
        if !reused.is_dir() || !owned_here(&wide, user)? {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "the folder belongs to another account",
            ));
        }
        Ok(())
    }

    pub(super) fn owned_by_current_user(path: &Path) -> io::Result<bool> {
        if !std::fs::symlink_metadata(path)?.is_dir() {
            return Ok(false);
        }
        let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
        let token = user_token()?;
        let user = unsafe { &*token.as_ptr().cast::<TOKEN_USER>() }.User.Sid;
        owned_here(&wide, user)
    }

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
        fn a_private_folder_is_protected_and_stays_usable_on_a_second_call() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("Oleafly-0123456789abcdef");
            create_private_dir(&path).unwrap();
            create_private_dir(&path).unwrap();
            std::fs::write(path.join("child"), "kept").unwrap();
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
            let mut control = 0;
            let mut revision = 0;
            unsafe {
                assert_ne!(
                    GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                    0
                );
                assert_ne!(control & SE_DACL_PROTECTED, 0);
                LocalFree(descriptor);
            }
            assert_eq!(std::fs::read_to_string(path.join("child")).unwrap(), "kept");
        }

        #[test]
        fn a_private_folder_refuses_a_file_at_its_path() {
            let directory = tempfile::tempdir().unwrap();
            let path = directory.path().join("taken");
            std::fs::write(&path, "x").unwrap();
            assert!(create_private_dir(&path).is_err());
        }

        #[test]
        fn only_a_folder_this_account_holds_counts_as_owned() {
            let directory = tempfile::tempdir().unwrap();
            let mine = directory.path().join("Oleafly-0123456789abcdef");
            create_private_dir(&mine).unwrap();
            assert!(super::super::owned_by_current_user(&mine));

            let file = directory.path().join("taken");
            std::fs::write(&file, "x").unwrap();
            assert!(!super::super::owned_by_current_user(&file));
            assert!(!super::super::owned_by_current_user(
                &directory.path().join("missing")
            ));
        }

        #[test]
        fn a_folder_held_by_another_account_does_not_count_as_owned() {
            let system_root = std::env::var_os("SystemRoot").unwrap();
            let held_by_the_installer_service = Path::new(&system_root).join("System32");
            assert!(held_by_the_installer_service.is_dir());
            assert!(!super::super::owned_by_current_user(
                &held_by_the_installer_service
            ));
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

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    #[test]
    fn ownership_is_only_a_question_on_windows() {
        assert!(owned_by_current_user(Path::new("/no/such/folder")));
    }
}
