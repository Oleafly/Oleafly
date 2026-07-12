//! OS keychain / credential-store helpers for long-lived secrets.
//!
//! GitHub tokens and AI API keys are stored via the platform keyring
//! (macOS Keychain, Windows Credential Manager, Linux Secret Service) when
//! available. Falls back to in-config storage only if the keyring is
//! unavailable so the app keeps working in headless CI and locked-down hosts.

use keyring::Entry;

const SERVICE: &str = "com.openleaf.app";

/// The OS keychain is global: `OPENLEAF_DATA_DIR` isolates the disk for e2e
/// runs and dev sandboxes, but NOT keychain entries, so a test that saved or
/// cleared a token would clobber the real app's secrets. When the override is
/// set we skip the keyring entirely and rely on the 0600-config fallback.
fn keyring_disabled() -> bool {
    std::env::var_os("OPENLEAF_DATA_DIR").is_some()
}

fn entry(account: &str) -> Result<Entry, String> {
    if keyring_disabled() {
        return Err("keyring disabled (OPENLEAF_DATA_DIR is set)".into());
    }
    Entry::new(SERVICE, account).map_err(|e| format!("keyring entry: {e}"))
}

/// Persist a secret. Empty value deletes the entry.
pub fn set_secret(account: &str, value: &str) -> Result<(), String> {
    let e = entry(account)?;
    if value.is_empty() {
        match e.delete_credential() {
            Ok(()) => Ok(()),
            // Already absent is fine.
            Err(keyring::Error::NoEntry) => Ok(()),
            Err(err) => Err(format!("keyring delete: {err}")),
        }
    } else {
        e.set_password(value)
            .map_err(|err| format!("keyring set: {err}"))
    }
}

/// Read a secret. Returns `None` when missing or keyring is unavailable.
pub fn get_secret(account: &str) -> Option<String> {
    let e = entry(account).ok()?;
    match e.get_password() {
        Ok(s) if !s.is_empty() => Some(s),
        _ => None,
    }
}

pub fn github_token_account() -> &'static str {
    "github_token"
}

pub fn mcp_token_account() -> &'static str {
    "mcp_token"
}

/// 256-bit random bearer token, lowercase hex.
pub fn generate_mcp_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn ai_key_account(provider: &str) -> String {
    format!("ai_key:{provider}")
}

/// Best-effort: migrate a plaintext value from config into the keyring and
/// return the value that should remain in the config file (empty when migration
/// succeeded, original when keyring is unavailable).
pub fn migrate_to_keyring(account: &str, plaintext: &str) -> String {
    if plaintext.is_empty() {
        return String::new();
    }
    match set_secret(account, plaintext) {
        Ok(()) => String::new(),         // blank the on-disk copy
        Err(_) => plaintext.to_string(), // keep in config as fallback
    }
}

/// Resolve a secret: prefer keyring, fall back to the config value (legacy).
pub fn resolve_secret(account: &str, config_value: &str) -> String {
    if let Some(s) = get_secret(account) {
        return s;
    }
    config_value.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_token_shape() {
        let t = generate_mcp_token();
        assert_eq!(t.len(), 64);
        assert!(t
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(generate_mcp_token(), t, "tokens must be random");
    }
}
