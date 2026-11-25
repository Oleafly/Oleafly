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

pub fn github_token_account() -> &'static str {
    oleafly_secrets::accounts::GITHUB_TOKEN_ACCOUNT
}

pub fn read_connector_secrets() -> Result<HashMap<String, String>, String> {
    store()?.read(SecretFile::Connector)
}

pub fn write_connector_secrets(values: &HashMap<String, String>) -> Result<(), String> {
    store()?.write(SecretFile::Connector, values)
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
