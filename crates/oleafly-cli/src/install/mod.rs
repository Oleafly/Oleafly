//! Putting `oleafly` on the user's PATH. macOS and Linux link it from the
//! app (`src-tauri/src/shell_command/unix.rs`); Windows copies it, with the
//! logic here so the app, the installer hook and the CLI share it.
pub mod windows;

/// `oleafly internal remove-command-line-tool`: the uninstaller removes the
/// Windows terminal command if this app installed it. Never fails.
pub fn remove_command_line_tool() {
    #[cfg(windows)]
    {
        let Some(local_app_data) =
            std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty())
        else {
            return;
        };
        let Some(data_root) = crate::app_paths::data_root() else {
            return;
        };
        let user_path = windows::RegistryUserPath;
        let env = windows::InstallEnv {
            local_app_data: std::path::PathBuf::from(local_app_data),
            data_root,
            bundled: None,
            user_path: &user_path,
            expand: &windows::expand_variables,
        };
        if windows::read_record(&env.data_root).is_some() {
            let _ = windows::uninstall(&env);
        }
    }
}
