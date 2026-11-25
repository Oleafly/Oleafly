use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

static CONNECTOR_WRITES: Mutex<()> = Mutex::new(());

pub(crate) fn is_reserved_connector(id: &str) -> bool {
    !matches!(
        id,
        "semantic-scholar" | "openalex-email" | "openalex-api-key" | "serper"
    )
}

pub(crate) fn update_connector_secrets(
    edit: impl FnOnce(&mut HashMap<String, String>),
) -> Result<(), String> {
    let _guard = CONNECTOR_WRITES
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let mut all = crate::secrets::read_connector_secrets()?;
    edit(&mut all);
    crate::secrets::write_connector_secrets(&all)
}

pub(crate) fn saved_connector_key(connector_id: &str) -> Result<Option<String>, String> {
    if is_reserved_connector(connector_id) {
        return Ok(None);
    }
    let all = crate::secrets::read_connector_secrets()?;
    Ok(all
        .get(connector_id)
        .map(|key| key.trim().to_owned())
        .filter(|key| !key.is_empty()))
}

#[tauri::command]
pub fn connector_key_saved(connector_id: String) -> Result<bool, String> {
    Ok(saved_connector_key(&connector_id)?.is_some())
}

#[tauri::command]
pub fn set_connector_key(connector_id: String, value: String) -> Result<(), String> {
    if is_reserved_connector(&connector_id) {
        return Err("This key can only be changed from its own settings.".into());
    }
    update_connector_secrets(|all| {
        if value.is_empty() {
            all.remove(&connector_id);
        } else {
            all.insert(connector_id, value);
        }
    })
}
