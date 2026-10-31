use oleafly_cli::install::windows::{
    expand_variables, install, refresh_if_outdated, status, uninstall, InstallEnv, InstallError,
    RegistryUserPath, WindowsStatus,
};
use serde::Serialize;

use crate::app_error::AppError;

static CHANGES: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
pub struct ShellCommandChange {
    action: &'static str,
    status: WindowsStatus,
}

fn app_error(error: InstallError) -> AppError {
    let mut app = AppError::new(error.code);
    for (key, value) in &error.params {
        app = app.param(key, value);
    }
    if let Some(detail) = error.detail {
        app = app.detail(detail);
    }
    app
}

fn with_env<T>(work: impl FnOnce(&InstallEnv) -> Result<T, AppError>) -> Result<T, AppError> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| AppError::new("shell_command.failed").detail("LOCALAPPDATA is not set"))?;
    let data_root = crate::paths::oleafly_root()
        .map_err(|error| AppError::new("shell_command.failed").detail(error))?;
    let bundled = oleafly_core::sidecar::executable_dir()
        .map(|dir| dir.join("oleafly-cli.exe"))
        .filter(|path| path.is_file());
    let user_path = RegistryUserPath;
    let env = InstallEnv {
        local_app_data,
        data_root,
        bundled,
        user_path: &user_path,
        expand: &expand_variables,
    };
    work(&env)
}

async fn blocking<T: Send + 'static>(
    task: impl FnOnce() -> Result<T, AppError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(task)
        .await
        .map_err(|error| String::from(AppError::new("shell_command.failed").detail(error)))?
        .map_err(String::from)
}

#[tauri::command]
pub async fn shell_command_status() -> Result<WindowsStatus, String> {
    blocking(|| with_env(|env| Ok(status(env)))).await
}

#[tauri::command]
pub async fn shell_command_install() -> Result<ShellCommandChange, String> {
    blocking(|| {
        let _change = CHANGES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        with_env(|env| {
            let status = install(env).map_err(app_error)?;
            Ok(ShellCommandChange {
                action: "copied",
                status,
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn shell_command_uninstall() -> Result<ShellCommandChange, String> {
    blocking(|| {
        let _change = CHANGES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        with_env(|env| {
            let status = uninstall(env).map_err(app_error)?;
            Ok(ShellCommandChange {
                action: "removed",
                status,
            })
        })
    })
    .await
}

pub fn refresh_installed_copy() {
    let _change = CHANGES
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let result = with_env(|env| refresh_if_outdated(env).map_err(app_error));
    if let Err(error) = result {
        let _ = crate::project::append_app_log(format!(
            "could not update the terminal command: {}",
            String::from(error)
        ));
    }
}
