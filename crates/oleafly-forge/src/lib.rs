//! Git hosting accounts for the Oleafly app and the `oleafly` CLI: GitHub,
//! GitLab, Gitea, Forgejo and Codeberg, hosted or run by the user.
//!
//! This crate owns the rules both runtimes share: base-URL normalization,
//! which account a remote belongs to, the account metadata file
//! (`forge-accounts.json`), the HTTP client (native roots, an optional
//! per-account CA file, redirects that never carry a token to another
//! origin), the per-server REST clients, server detection, and OAuth (the
//! GitHub and GitLab device flow, GitLab token refresh).
//!
//! Tokens live only in the encrypted `forge_tokens` secret of
//! `oleafly-secrets`. Nothing here touches Tauri; the app and the CLI pass
//! their data folder in.

pub mod accounts;
pub mod address;
pub mod api;
pub mod detect;
pub mod error;
pub mod git;
pub mod http;
pub mod kind;
pub mod oauth;
pub mod repo_path;
pub mod store;
#[cfg(any(test, feature = "test-support"))]
pub mod test_support;

pub use error::ForgeError;
pub use kind::{AuthMethod, ForgeKind, ServerFlavor};
pub use oleafly_secrets::accounts::ForgeToken;
pub use store::{ForgeAccount, ForgeStore};

/// Run blocking store work (file locks, file IO) off the async runtime.
pub(crate) async fn blocking<T, F>(work: F) -> Result<T, ForgeError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, ForgeError> + Send + 'static,
{
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| ForgeError::Store {
            detail: format!("the account store worker stopped: {error}"),
        })?
}

/// Milliseconds since the Unix epoch.
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
