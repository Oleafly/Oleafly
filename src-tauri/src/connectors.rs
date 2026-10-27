//! Tauri commands for the per-connector API keys the research toolset uses.
//! Storage lives in `secrets.rs`; this module is transport only.
//!
//! The webview can save or clear a key and learn whether one is saved, but
//! never read one back: only the backend uses the keys. Mathpix keys
//! (`mathpix.*`) are written and read only by `mathpix.rs`, so the generic
//! commands refuse them.

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

fn saved_connector_key(connector_id: &str) -> Result<Option<String>, String> {
    if is_reserved_connector(connector_id) {
        return Ok(None);
    }
    let all = crate::secrets::read_connector_secrets()?;
    Ok(all.get(connector_id).cloned())
}

/// Whether a key is saved for `connector_id`; the key itself stays here.
#[tauri::command]
pub fn connector_key_saved(connector_id: String) -> Result<bool, String> {
    Ok(saved_connector_key(&connector_id)?.is_some_and(|key| !key.trim().is_empty()))
}

/// Removes and returns a key, for a migration that moves it elsewhere in the
/// backend. Nothing is written when no key is saved.
pub(crate) fn take_connector_key(connector_id: &str) -> Result<Option<String>, String> {
    let _guard = CONNECTOR_WRITES
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    let mut all = crate::secrets::read_connector_secrets()?;
    let Some(key) = all.remove(connector_id) else {
        return Ok(None);
    };
    crate::secrets::write_connector_secrets(&all)?;
    Ok(Some(key.trim().to_owned()).filter(|key| !key.is_empty()))
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
        assert_eq!(saved_connector_key("mathpix.app_key").unwrap(), None);
        assert_eq!(saved_connector_key("mathpix.app_id").unwrap(), None);
        assert!(!connector_key_saved("mathpix.app_key".into()).unwrap());
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
            saved_connector_key("serper").unwrap().as_deref(),
            Some("serper-key")
        );
        assert!(connector_key_saved("serper".into()).unwrap());
        assert_eq!(saved_connector_key("mathpix.app_id").unwrap(), None);
        assert!(!connector_key_saved("mathpix.app_id".into()).unwrap());
        set_connector_key("serper".into(), String::new()).unwrap();
        assert_eq!(saved_connector_key("serper").unwrap(), None);
        assert!(!connector_key_saved("serper".into()).unwrap());
        let stored = crate::secrets::read_connector_secrets().unwrap();
        assert_eq!(
            stored.get("mathpix.app_id").map(String::as_str),
            Some("app")
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }

    #[test]
    fn a_blank_key_is_not_saved_and_a_taken_key_is_gone() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
        set_connector_key("tavily".into(), "   ".into()).unwrap();
        assert!(!connector_key_saved("tavily".into()).unwrap());
        assert_eq!(take_connector_key("alphaxiv").unwrap(), None);
        set_connector_key("alphaxiv".into(), " legacy-key ".into()).unwrap();
        assert_eq!(
            take_connector_key("alphaxiv").unwrap().as_deref(),
            Some("legacy-key")
        );
        assert!(!connector_key_saved("alphaxiv".into()).unwrap());
        assert_eq!(take_connector_key("alphaxiv").unwrap(), None);
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
