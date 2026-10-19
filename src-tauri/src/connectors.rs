//! Tauri commands exposing per-connector API keys to the frontend research
//! toolset. Storage lives in `secrets.rs`; this module is transport only.
//!
//! Some connector accounts belong to the backend alone. Mathpix keys
//! (`mathpix.*`) are written and read only by `mathpix.rs`, so the generic
//! commands refuse them and the app key never reaches the webview.

use std::collections::HashMap;
use std::sync::{Mutex, PoisonError};

/// Serializes read-modify-write cycles on the connector secrets file, so two
/// saves at once cannot drop each other's key.
static CONNECTOR_WRITES: Mutex<()> = Mutex::new(());

/// Accounts only the backend may read or write.
pub(crate) fn is_reserved_connector(id: &str) -> bool {
    id.starts_with("mathpix.")
}

/// Reads the connector map, lets `edit` change it, and writes it back.
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

#[tauri::command]
pub fn get_connector_key(connector_id: String) -> Result<Option<String>, String> {
    if is_reserved_connector(&connector_id) {
        return Ok(None);
    }
    let all = crate::secrets::read_connector_secrets()?;
    Ok(all.get(&connector_id).cloned())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mathpix_keys_never_cross_the_generic_connector_commands() {
        // Both return before the secrets file is read.
        assert_eq!(get_connector_key("mathpix.app_key".into()).unwrap(), None);
        assert_eq!(get_connector_key("mathpix.app_id".into()).unwrap(), None);
        assert!(set_connector_key("mathpix.app_id".into(), "x".into()).is_err());
        assert!(set_connector_key("mathpix.app_key".into(), String::new()).is_err());
        assert!(is_reserved_connector("mathpix.anything"));
        assert!(!is_reserved_connector("serper"));
        assert!(!is_reserved_connector("mathpix"));
    }

    #[test]
    fn connector_keys_round_trip_through_the_locked_update() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
        set_connector_key("serper".into(), "serper-key".into()).unwrap();
        update_connector_secrets(|all| {
            all.insert("mathpix.app_id".into(), "app".into());
        })
        .unwrap();
        assert_eq!(
            get_connector_key("serper".into()).unwrap().as_deref(),
            Some("serper-key")
        );
        assert_eq!(get_connector_key("mathpix.app_id".into()).unwrap(), None);
        set_connector_key("serper".into(), String::new()).unwrap();
        assert_eq!(get_connector_key("serper".into()).unwrap(), None);
        let stored = crate::secrets::read_connector_secrets().unwrap();
        assert_eq!(
            stored.get("mathpix.app_id").map(String::as_str),
            Some("app")
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
