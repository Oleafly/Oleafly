//! Encrypted, on-disk storage for long-lived secrets (Git and Git-host tokens,
//! the MCP token, AI provider keys, connector keys) and the private-file
//! helpers it needs, shared by the Oleafly app, the `oleafly` CLI and the
//! background daemon.
//!
//! Nothing here touches the OS keychain except the optional `keychain`
//! module. An unsigned dev build gets a fresh code identity each launch, so
//! the keychain never remembers its access grant and re-prompts on every run;
//! storing secrets in an AES-256-GCM file under the data folder (0600 on unix,
//! owner-only ACL on Windows) avoids that and keeps e2e and dev sandboxes
//! isolated through `OLEAFLY_DATA_DIR`.
//!
//! The store always takes an explicit root ([`SecretStore::at`]). The app
//! passes its own data folder (which has a test-only default), the CLI passes
//! [`paths::data_root`].

pub mod accounts;
pub mod fs;
pub mod fsperm;
#[cfg(feature = "keychain")]
pub mod keychain;
pub mod paths;
mod store;

pub use store::{SecretFile, SecretStore, KEY_FILE};

pub fn generate_token() -> String {
    use rand::RngCore;
    let mut bytes = [0u8; 32];
    rand::rngs::OsRng.fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generated_tokens_are_64_lowercase_hex_and_random() {
        let token = generate_token();
        assert_eq!(token.len(), 64);
        assert!(token
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()));
        assert_ne!(generate_token(), token, "tokens must be random");
    }
}
