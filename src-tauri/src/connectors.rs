//! Tauri commands exposing per-connector API keys to the frontend research
//! toolset. Storage lives in `secrets.rs`; this module is transport only.

#[tauri::command]
pub async fn get_connector_key(connector_id: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let all = crate::secrets::read_connector_secrets()?;
        Ok(all.get(&connector_id).cloned())
    })
    .await
    .map_err(|error| format!("failed to read the connector key: {error}"))?
}

#[tauri::command]
pub async fn set_connector_key(connector_id: String, value: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut all = crate::secrets::read_connector_secrets()?;
        if value.is_empty() {
            all.remove(&connector_id);
        } else {
            all.insert(connector_id, value);
        }
        crate::secrets::write_connector_secrets(&all)
    })
    .await
    .map_err(|error| format!("failed to store the connector key: {error}"))?
}
