use oleafly_secrets::{SecretFile, SecretStore};
use std::collections::HashMap;

pub use oleafly_secrets::keychain::{BackendChoice, SecretBackend};

pub fn store() -> Result<SecretStore, String> {
    Ok(SecretStore::at(crate::paths::oleafly_root()?))
}

pub fn set_secrets(values: &[(&str, &str)]) -> Result<(), String> {
    store()?.set(values)
}

pub fn get_secret(account: &str) -> Result<Option<String>, String> {
    store()?.get(account)
}

#[cfg(test)]
pub fn update_secret<T>(
    account: &str,
    edit: impl FnOnce(&mut Option<String>) -> T,
) -> Result<T, String> {
    store()?.update(account, edit)
}

pub fn github_token_account() -> &'static str {
    oleafly_secrets::accounts::GITHUB_TOKEN_ACCOUNT
}

pub fn mcp_token_account() -> &'static str {
    oleafly_secrets::accounts::MCP_TOKEN_ACCOUNT
}

pub fn generate_mcp_token() -> String {
    oleafly_secrets::generate_token()
}

pub fn read_ai_secrets() -> Result<HashMap<String, String>, String> {
    store()?.read(SecretFile::Ai)
}

pub fn write_ai_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    store()?.write(SecretFile::Ai, values)
}

pub fn read_connector_secrets() -> Result<HashMap<String, String>, String> {
    store()?.read(SecretFile::Connector)
}

pub fn write_connector_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    store()?.write(SecretFile::Connector, values)
}

pub fn read_mcp_server_secrets() -> Result<HashMap<String, String>, String> {
    store()?.read(SecretFile::McpServer)
}

pub fn write_mcp_server_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    store()?.write(SecretFile::McpServer, values)
}

pub fn resolve_secret(account: &str, config_value: &str) -> Result<String, String> {
    if let Some(s) = get_secret(account)? {
        return Ok(s);
    }
    Ok(config_value.to_string())
}

pub fn cloud_secret_backend() -> BackendChoice {
    oleafly_secrets::keychain::cloud_secret_backend()
}

pub fn set_cloud_secret(account: &str, value: &str) -> Result<BackendChoice, String> {
    oleafly_secrets::keychain::set_cloud_secret(&store()?, account, value)
}

pub fn get_cloud_secret(account: &str, backend: SecretBackend) -> Result<Option<String>, String> {
    oleafly_secrets::keychain::get_cloud_secret(&store()?, account, backend)
}

pub fn delete_cloud_secret(account: &str, backend: SecretBackend) -> Result<(), String> {
    oleafly_secrets::keychain::delete_cloud_secret(&store()?, account, backend)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn connector_secrets_round_trip() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = std::env::temp_dir().join(format!(
            "oleafly-connector-secrets-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let mut values = HashMap::new();
        values.insert("alphaxiv".to_string(), "test-key-123".to_string());
        write_connector_secrets(&values).unwrap();
        let back = read_connector_secrets().unwrap();
        assert_eq!(back.get("alphaxiv").unwrap(), "test-key-123");
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn mcp_server_secrets_round_trip_without_plaintext() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = std::env::temp_dir().join(format!(
            "oleafly-mcp-server-secrets-{}-{}",
            std::process::id(),
            generate_mcp_token()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", &dir);
        let values = HashMap::from([
            (
                "[\"local-search\",\"env\",\"SEARCH_TOKEN\"]".to_string(),
                "stdio-secret".to_string(),
            ),
            (
                "[\"hosted-search\",\"header\",\"Authorization\"]".to_string(),
                "Bearer remote-secret".to_string(),
            ),
        ]);

        write_mcp_server_secrets(&values).unwrap();

        let stored = std::fs::read_to_string(dir.join("mcp-server-secrets.json")).unwrap();
        assert!(!stored.contains("stdio-secret"));
        assert!(!stored.contains("remote-secret"));
        assert_eq!(read_mcp_server_secrets().unwrap(), values);
        std::env::remove_var("OLEAFLY_DATA_DIR");
        std::fs::remove_dir_all(dir).ok();
    }

    #[test]
    fn the_shim_and_the_crate_share_one_store() {
        let _env_guard = crate::paths::data_dir_env_lock();
        let dir = tempfile::tempdir().unwrap();
        std::env::set_var("OLEAFLY_DATA_DIR", dir.path());
        SecretStore::at(dir.path())
            .set(&[("written_by_cli", "v1")])
            .unwrap();
        assert_eq!(get_secret("written_by_cli").unwrap().as_deref(), Some("v1"));
        update_secret("written_by_cli", |slot| *slot = Some("v2".into())).unwrap();
        assert_eq!(
            SecretStore::at(dir.path())
                .get("written_by_cli")
                .unwrap()
                .as_deref(),
            Some("v2")
        );
        std::env::remove_var("OLEAFLY_DATA_DIR");
    }
}
