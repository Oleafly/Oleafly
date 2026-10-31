pub mod windows;

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
