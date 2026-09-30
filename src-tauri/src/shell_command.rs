#[cfg(unix)]
pub(crate) mod unix;

use crate::app_error::AppError;

#[cfg(unix)]
static CHANGES: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(unix)]
async fn blocking<T: Send + 'static>(
    task: impl FnOnce(&unix::Environment) -> Result<T, AppError> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let environment = unix::Environment::current()?;
        task(&environment)
    })
    .await
    .map_err(|error| String::from(AppError::new("shell_command.failed").detail(error)))?
    .map_err(String::from)
}

#[cfg(unix)]
fn shell_path(
    environment: &unix::Environment,
) -> impl Fn(unix::ShellStart) -> Vec<std::path::PathBuf> + '_ {
    |start| unix::shell_path(environment.shell.as_deref(), start)
}

#[cfg(unix)]
#[tauri::command]
pub async fn shell_command_status() -> Result<unix::ShellCommandStatus, String> {
    blocking(|environment| Ok(unix::status(environment, &shell_path(environment)))).await
}

#[cfg(unix)]
#[tauri::command]
pub async fn shell_command_install() -> Result<unix::ShellCommandChange, String> {
    blocking(|environment| {
        let _change = CHANGES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        unix::install(environment, &shell_path(environment))
    })
    .await
}

#[cfg(unix)]
#[tauri::command]
pub async fn shell_command_uninstall() -> Result<unix::ShellCommandChange, String> {
    blocking(|environment| {
        let _change = CHANGES
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        unix::uninstall(environment, &shell_path(environment))
    })
    .await
}

#[cfg(not(unix))]
#[derive(serde::Serialize)]
pub struct UnsupportedStatus {
    state: &'static str,
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn shell_command_status() -> Result<UnsupportedStatus, String> {
    Ok(UnsupportedStatus {
        state: "unsupported",
    })
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn shell_command_install() -> Result<(), String> {
    Err(AppError::new("shell_command.unsupported").into())
}

#[cfg(not(unix))]
#[tauri::command]
pub async fn shell_command_uninstall() -> Result<(), String> {
    Err(AppError::new("shell_command.unsupported").into())
}
